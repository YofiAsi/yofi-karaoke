// Lyrics lookup: LRCLIB exact match, then LRCLIB search, then lyrics.ovh, within one bounded run.
import { env } from "../env.js";
import { buildLyricsCandidates, type LyricsCandidate, type LyricsQueryInput } from "./lyricsQuery.js";

export type LyricsSource = "lrclib" | "lrclib_plain" | "ovh" | "whisper" | "aligned" | "manual" | "none";
export type LyricsMissReason =
  | "no_candidates"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "http_error";

export interface LyricsResult {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  source: LyricsSource;
  missReason: LyricsMissReason | null;
  matchedQuery: string | null;
}

export interface LrclibEntry {
  trackName?: string | null;
  artistName?: string | null;
  duration?: number | null;
  instrumental?: boolean | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

export type LyricsLogger = (message: string) => void;

export type LyricsLookupParams = LyricsQueryInput & { durationSeconds: number };

export const TRANSIENT_MISS_REASONS: ReadonlySet<LyricsMissReason> = new Set([
  "rate_limited",
  "timeout",
  "network_error",
  "http_error",
]);

type FailureKind = Exclude<LyricsMissReason, "no_candidates" | "not_found">;

type HttpOutcome<T> =
  | { kind: "ok"; body: T }
  | { kind: "not_found" }
  | { kind: "skipped" }
  | { kind: FailureKind; detail: string };

interface Match {
  entry: LrclibEntry;
  query: string;
}

interface LookupRun {
  deadlineAt: number;
  lrclibBlockedBy: FailureKind | null;
  failures: Set<FailureKind>;
  log: LyricsLogger;
}

const USER_AGENT = "karaoke-worker/0.2 (self hosted party karaoke)";
const MAX_DURATION_DELTA_SECONDS = 15;
export const LOOKUP_DEADLINE_MS = 45_000;
const MAX_RETRY_DELAY_MS = 10_000;
const FAILURE_PRIORITY: FailureKind[] = ["rate_limited", "timeout", "network_error", "http_error"];
const BREAKER_FAILURES: ReadonlySet<FailureKind> = new Set(["rate_limited", "timeout", "network_error"]);
const TRACK_ONLY_KINDS = new Set(["metadata", "split"]);

let nextLrclibSlotAt = 0;

export async function fetchLyrics(
  params: LyricsLookupParams,
  log: LyricsLogger = defaultLogger,
  deadlineMs: number = LOOKUP_DEADLINE_MS,
): Promise<LyricsResult> {
  const run: LookupRun = { deadlineAt: Date.now() + deadlineMs, lrclibBlockedBy: null, failures: new Set(), log };
  try {
    return await lookupLyrics(params, run);
  } catch (err) {
    log(`lyrics lookup failed unexpectedly: ${errorDetail(err)}`);
    return miss("http_error");
  }
}

export function pickBestEntry(entries: unknown, durationSeconds: number): LrclibEntry | null {
  const usable = toEntries(entries).filter(
    (e) => !e.instrumental && (hasText(e.syncedLyrics) || hasText(e.plainLyrics)) && withinDuration(e, durationSeconds),
  );
  usable.sort((a, b) => syncedRank(a) - syncedRank(b) || durationDelta(a, durationSeconds) - durationDelta(b, durationSeconds));
  return usable[0] ?? null;
}

export function artistMatches(artistName: unknown, knownArtists: string[]): boolean {
  const artist = normalizeName(typeof artistName === "string" ? artistName : "");
  if (artist.length < 2) return false;
  return knownArtists.some((raw) => {
    const known = normalizeName(raw);
    return known.length >= 2 && (known.includes(artist) || artist.includes(known) || nearlyEqual(known, artist));
  });
}

const MIN_FUZZY_NAME_LENGTH = 6;

function nearlyEqual(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < MIN_FUZZY_NAME_LENGTH) return false;
  return editDistance(a, b) <= (Math.max(a.length, b.length) >= 12 ? 2 : 1);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

async function lookupLyrics(params: LyricsLookupParams, run: LookupRun): Promise<LyricsResult> {
  const candidates = buildLyricsCandidates(params);
  if (candidates.length === 0) {
    run.log(`lyrics miss: no usable query from title "${params.title}"`);
    return miss("no_candidates");
  }

  const direct = candidates.filter((c) => TRACK_ONLY_KINDS.has(c.kind));
  const loose = candidates.filter((c) => !TRACK_ONLY_KINDS.has(c.kind));
  const stages = [
    () => lookupEach(direct, params.durationSeconds, run),
    () => lookupTrackOnly(candidates, params, run),
    () => lookupEach(loose, params.durationSeconds, run),
  ];

  let plainFallback: Match | null = null;
  for (const stage of stages) {
    const found = await stage();
    if (found && hasText(found.entry.syncedLyrics)) return logHit(run, found, "lrclib");
    plainFallback ??= found;
  }
  if (plainFallback) return logHit(run, plainFallback, "lrclib_plain");

  const ovh = await lookupOvh(candidates[0], run);
  if (ovh) return ovh;

  const reason = FAILURE_PRIORITY.find((kind) => run.failures.has(kind)) ?? "not_found";
  run.log(`lyrics miss (${reason}) after ${candidates.map(describe).join("; ")}`);
  return miss(reason);
}

async function lookupCandidate(
  candidate: LyricsCandidate,
  durationSeconds: number,
  run: LookupRun,
): Promise<Match | null> {
  let plain: Match | null = null;
  for (const query of lrclibQueries(candidate, durationSeconds)) {
    const outcome = await lrclibRequest(query.path, query.params, query.label, run);
    if (outcome.kind !== "ok") continue;
    const entry = pickBestEntry(outcome.body, durationSeconds);
    if (!entry) continue;
    const match = { entry, query: query.label };
    if (hasText(entry.syncedLyrics)) return match;
    plain ??= match;
  }
  return plain;
}

async function lookupEach(
  candidates: LyricsCandidate[],
  durationSeconds: number,
  run: LookupRun,
): Promise<Match | null> {
  let plain: Match | null = null;
  for (const candidate of candidates) {
    const found = await lookupCandidate(candidate, durationSeconds, run);
    if (found && hasText(found.entry.syncedLyrics)) return found;
    plain ??= found;
  }
  return plain;
}

async function lookupTrackOnly(
  candidates: LyricsCandidate[],
  params: LyricsLookupParams,
  run: LookupRun,
): Promise<Match | null> {
  const knownArtists = trustedArtists(candidates, params);
  let plain: Match | null = null;
  for (const track of trackOnlyTracks(candidates)) {
    const label = `search track="${track}" with artist check`;
    const outcome = await lrclibRequest("/api/search", { track_name: track }, label, run);
    if (outcome.kind !== "ok") continue;
    const sameArtist = toEntries(outcome.body).filter((e) => artistMatches(e.artistName, knownArtists));
    const entry = pickBestEntry(sameArtist, params.durationSeconds);
    if (!entry) continue;
    const match = { entry, query: label };
    if (hasText(entry.syncedLyrics)) return match;
    plain ??= match;
  }
  return plain;
}

async function lookupOvh(candidate: LyricsCandidate, run: LookupRun): Promise<LyricsResult | null> {
  const query = `ovh ${describe(candidate)}`;
  const remainingMs = run.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    run.log(`lyrics skipped ${query}: lookup deadline reached`);
    return null;
  }
  const outcome = await fetchFromOvh(candidate, Math.min(env.LYRICS_OVH_TIMEOUT_MS, remainingMs));
  if (outcome.kind === "ok" && hasText(outcome.body)) {
    run.log(`lyrics hit (plain only) via ${query}`);
    return { ...miss(null), plainLyrics: outcome.body, source: "ovh", matchedQuery: query };
  }
  if ("detail" in outcome) run.log(`lyrics ${outcome.kind} for ${query}: ${outcome.detail}`);
  return null;
}

function trustedArtists(candidates: LyricsCandidate[], params: LyricsLookupParams): string[] {
  const candidateArtists = candidates.filter((c) => c.kind !== "swapped").map((c) => c.artist);
  return [params.artist, params.trackArtist ?? "", ...candidateArtists];
}

function trackOnlyTracks(candidates: LyricsCandidate[]): string[] {
  return [...new Set(candidates.filter((c) => TRACK_ONLY_KINDS.has(c.kind)).map((c) => c.track))];
}

function lrclibQueries(candidate: LyricsCandidate, durationSeconds: number) {
  const exactParams: Record<string, string> = { track_name: candidate.track, artist_name: candidate.artist };
  if (durationSeconds > 0) exactParams.duration = String(durationSeconds);
  return [
    { path: "/api/get", params: exactParams, label: `get ${describe(candidate)}` },
    {
      path: "/api/search",
      params: { track_name: candidate.track, artist_name: candidate.artist },
      label: `search ${describe(candidate)}`,
    },
    {
      path: "/api/search",
      params: { q: `${candidate.artist} ${candidate.track}` },
      label: `search q="${candidate.artist} ${candidate.track}"`,
    },
  ];
}

async function lrclibRequest(
  path: string,
  params: Record<string, string>,
  label: string,
  run: LookupRun,
): Promise<HttpOutcome<unknown>> {
  const url = new URL(path, env.LRCLIB_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 0; ; attempt++) {
    if (!canQueryLrclib(run)) return { kind: "skipped" };
    await waitForLrclibSlot();
    const remainingMs = run.deadlineAt - Date.now();
    if (remainingMs <= 0) return recordOutcome(run, label, { kind: "timeout", detail: "lookup deadline reached" });
    const response = await fetchWithTimeout(url, Math.min(env.LRCLIB_TIMEOUT_MS, remainingMs));
    if (!(response instanceof Response)) return recordOutcome(run, label, response);
    if (response.status === 429 && attempt < env.LRCLIB_MAX_RETRIES) {
      await sleep(Math.min(retryDelayMs(response, attempt), Math.max(0, run.deadlineAt - Date.now())));
      continue;
    }
    return recordOutcome(run, label, await toOutcome(response));
  }
}

function canQueryLrclib(run: LookupRun): boolean {
  if (run.lrclibBlockedBy) return false;
  if (Date.now() < run.deadlineAt) return true;
  blockLrclib(run, "timeout", "lookup deadline reached");
  return false;
}

function recordOutcome<T>(run: LookupRun, label: string, outcome: HttpOutcome<T>): HttpOutcome<T> {
  if (!("detail" in outcome)) return outcome;
  run.failures.add(outcome.kind);
  run.log(`lyrics ${outcome.kind} for ${label}: ${outcome.detail}`);
  if (BREAKER_FAILURES.has(outcome.kind)) blockLrclib(run, outcome.kind, "skipping remaining LRCLIB queries");
  return outcome;
}

function blockLrclib(run: LookupRun, kind: FailureKind, reason: string): void {
  if (run.lrclibBlockedBy) return;
  run.lrclibBlockedBy = kind;
  run.failures.add(kind);
  run.log(`lyrics LRCLIB disabled for this lookup (${kind}): ${reason}`);
}

async function fetchFromOvh(candidate: LyricsCandidate, timeoutMs: number): Promise<HttpOutcome<string | null>> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(candidate.artist)}/${encodeURIComponent(candidate.track)}`;
  const response = await fetchWithTimeout(new URL(url), timeoutMs);
  if (!(response instanceof Response)) return response;
  const outcome = await toOutcome(response);
  if (outcome.kind !== "ok") return outcome;
  const lyrics = isRecord(outcome.body) ? outcome.body.lyrics : null;
  return { kind: "ok", body: typeof lyrics === "string" ? lyrics : null };
}

async function fetchWithTimeout(
  url: URL,
  timeoutMs: number,
): Promise<Response | { kind: "timeout" | "network_error"; detail: string }> {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { kind: "timeout", detail: `no response within ${timeoutMs}ms` };
    }
    return { kind: "network_error", detail: errorDetail(err) };
  }
}

async function toOutcome(response: Response): Promise<HttpOutcome<unknown>> {
  if (response.status === 404) return { kind: "not_found" };
  if (response.status === 429) return { kind: "rate_limited", detail: "HTTP 429 after retries" };
  if (!response.ok) return { kind: "http_error", detail: `HTTP ${response.status}` };
  try {
    return { kind: "ok", body: (await response.json()) as unknown };
  } catch (err) {
    return { kind: "http_error", detail: `invalid JSON: ${errorDetail(err)}` };
  }
}

async function waitForLrclibSlot(): Promise<void> {
  while (Date.now() < nextLrclibSlotAt) await sleep(nextLrclibSlotAt - Date.now());
  nextLrclibSlotAt = Date.now() + env.LRCLIB_MIN_INTERVAL_MS;
}

export function retryDelayMs(response: Response, attempt: number): number {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  const requested = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 2_000 * 2 ** attempt;
  return Math.min(requested, MAX_RETRY_DELAY_MS);
}

function logHit(run: LookupRun, match: Match, source: LyricsSource): LyricsResult {
  run.log(`lyrics hit (${source === "lrclib" ? "synced" : "plain only"}) via ${match.query}`);
  return {
    syncedLyrics: textOrNull(match.entry.syncedLyrics),
    plainLyrics: textOrNull(match.entry.plainLyrics),
    source,
    missReason: null,
    matchedQuery: match.query,
  };
}

function miss(reason: LyricsMissReason | null): LyricsResult {
  return { syncedLyrics: null, plainLyrics: null, source: "none", missReason: reason, matchedQuery: null };
}

function toEntries(body: unknown): LrclibEntry[] {
  if (Array.isArray(body)) return body.filter(isRecord) as LrclibEntry[];
  return isRecord(body) ? [body as LrclibEntry] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withinDuration(entry: LrclibEntry, durationSeconds: number): boolean {
  if (durationSeconds <= 0 || typeof entry.duration !== "number") return true;
  return durationDelta(entry, durationSeconds) <= MAX_DURATION_DELTA_SECONDS;
}

function durationDelta(entry: LrclibEntry, durationSeconds: number): number {
  if (durationSeconds <= 0 || typeof entry.duration !== "number") return MAX_DURATION_DELTA_SECONDS;
  return Math.abs(entry.duration - durationSeconds);
}

function syncedRank(entry: LrclibEntry): number {
  return hasText(entry.syncedLyrics) ? 0 : 1;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function textOrNull(value: unknown): string | null {
  return hasText(value) ? value : null;
}

function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function describe(candidate: LyricsCandidate): string {
  return `"${candidate.artist}" / "${candidate.track}"`;
}

function errorDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLogger(message: string): void {
  console.log(JSON.stringify({ msg: message, scope: "lyrics" }));
}
