// Lyrics lookup: LRCLIB exact match, then LRCLIB search, then lyrics.ovh.
import { env } from "../env.js";
import { buildLyricsCandidates, type LyricsCandidate, type LyricsQueryInput } from "./lyricsQuery.js";

export type LyricsSource = "lrclib" | "lrclib_plain" | "ovh" | "none";
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

type FailureKind = Exclude<LyricsMissReason, "no_candidates" | "not_found">;

type HttpOutcome<T> =
  | { kind: "ok"; body: T }
  | { kind: "not_found" }
  | { kind: FailureKind; detail: string };

interface Match {
  entry: LrclibEntry;
  query: string;
}

const USER_AGENT = "karaoke-worker/0.2 (self hosted party karaoke)";
const MAX_DURATION_DELTA_SECONDS = 15;
const FAILURE_PRIORITY: FailureKind[] = ["rate_limited", "timeout", "network_error", "http_error"];

let nextLrclibSlotAt = 0;

export async function fetchLyrics(
  params: LyricsQueryInput & { durationSeconds: number },
  log: LyricsLogger = defaultLogger,
): Promise<LyricsResult> {
  const candidates = buildLyricsCandidates(params);
  if (candidates.length === 0) {
    log(`lyrics miss: no usable query from title "${params.title}"`);
    return miss("no_candidates");
  }

  const failures = new Set<FailureKind>();
  const recordFailure = (outcome: HttpOutcome<unknown>, query: string) => {
    if (outcome.kind === "ok" || outcome.kind === "not_found") return;
    failures.add(outcome.kind);
    log(`lyrics ${outcome.kind} for ${query}: ${outcome.detail}`);
  };

  let plainFallback: Match | null = null;
  for (const candidate of candidates) {
    const found = await lookupCandidate(candidate, params.durationSeconds, recordFailure);
    if (found && hasText(found.entry.syncedLyrics)) {
      log(`lyrics hit (synced) via ${found.query}`);
      return hit(found, "lrclib");
    }
    plainFallback ??= found;
  }

  if (plainFallback) {
    log(`lyrics hit (plain only) via ${plainFallback.query}`);
    return hit(plainFallback, "lrclib_plain");
  }

  const ovhQuery = `ovh ${describe(candidates[0])}`;
  const ovh = await fetchFromOvh(candidates[0]);
  if (ovh.kind === "ok" && hasText(ovh.body)) {
    log(`lyrics hit (plain only) via ${ovhQuery}`);
    return { ...miss(null), plainLyrics: ovh.body, source: "ovh", matchedQuery: ovhQuery };
  }
  if (ovh.kind !== "ok") log(`lyrics ${ovh.kind} for ${ovhQuery}${"detail" in ovh ? `: ${ovh.detail}` : ""}`);

  const reason = FAILURE_PRIORITY.find((kind) => failures.has(kind)) ?? "not_found";
  log(`lyrics miss (${reason}) after ${candidates.map(describe).join("; ")}`);
  return miss(reason);
}

export function pickBestEntry(entries: LrclibEntry[], durationSeconds: number): LrclibEntry | null {
  const usable = entries.filter(
    (e) => !e.instrumental && (hasText(e.syncedLyrics) || hasText(e.plainLyrics)) && withinDuration(e, durationSeconds),
  );
  usable.sort((a, b) => syncedRank(a) - syncedRank(b) || durationDelta(a, durationSeconds) - durationDelta(b, durationSeconds));
  return usable[0] ?? null;
}

async function lookupCandidate(
  candidate: LyricsCandidate,
  durationSeconds: number,
  recordFailure: (outcome: HttpOutcome<unknown>, query: string) => void,
): Promise<Match | null> {
  let plain: Match | null = null;
  for (const query of lrclibQueries(candidate, durationSeconds)) {
    const outcome = await lrclibRequest<LrclibEntry | LrclibEntry[]>(query.path, query.params);
    recordFailure(outcome, query.label);
    if (outcome.kind !== "ok") continue;
    const entry = pickBestEntry(toArray(outcome.body), durationSeconds);
    if (!entry) continue;
    const match = { entry, query: query.label };
    if (hasText(entry.syncedLyrics)) return match;
    plain ??= match;
  }
  return plain;
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

async function lrclibRequest<T>(path: string, params: Record<string, string>): Promise<HttpOutcome<T>> {
  const url = new URL(path, env.LRCLIB_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 0; ; attempt++) {
    await waitForLrclibSlot();
    const response = await fetchWithTimeout(url, env.LRCLIB_TIMEOUT_MS);
    if (!(response instanceof Response)) return response;
    if (response.status === 429 && attempt < env.LRCLIB_MAX_RETRIES) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    return toOutcome<T>(response);
  }
}

async function fetchFromOvh(candidate: LyricsCandidate): Promise<HttpOutcome<string | null>> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(candidate.artist)}/${encodeURIComponent(candidate.track)}`;
  const response = await fetchWithTimeout(new URL(url), env.LYRICS_OVH_TIMEOUT_MS);
  if (!(response instanceof Response)) return response;
  const outcome = await toOutcome<{ lyrics?: string }>(response);
  return outcome.kind === "ok" ? { kind: "ok", body: outcome.body.lyrics ?? null } : outcome;
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

async function toOutcome<T>(response: Response): Promise<HttpOutcome<T>> {
  if (response.status === 404) return { kind: "not_found" };
  if (response.status === 429) return { kind: "rate_limited", detail: "HTTP 429 after retries" };
  if (!response.ok) return { kind: "http_error", detail: `HTTP ${response.status}` };
  try {
    return { kind: "ok", body: (await response.json()) as T };
  } catch (err) {
    return { kind: "http_error", detail: `invalid JSON: ${errorDetail(err)}` };
  }
}

async function waitForLrclibSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextLrclibSlotAt - now);
  nextLrclibSlotAt = Math.max(now, nextLrclibSlotAt) + env.LRCLIB_MIN_INTERVAL_MS;
  if (waitMs > 0) await sleep(waitMs);
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  return 2_000 * 2 ** attempt;
}

function hit(match: Match, source: LyricsSource): LyricsResult {
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

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function hasText(value: string | null | undefined): value is string {
  return !!value?.trim();
}

function textOrNull(value: string | null | undefined): string | null {
  return hasText(value) ? value : null;
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
