// Tab4U plain lyrics for Hebrew songs: paced search, strict title and artist match, one song page, breaker on blocks.
import { env } from "../env.js";
import { editDistance, normalizeToken } from "../lyrics/tokens.js";
import type { LyricsLogger } from "./lyrics.js";
import type { LyricsCandidate } from "./lyricsQuery.js";

export type Tab4uFailure = "rate_limited" | "timeout" | "network_error" | "http_error";

export type Tab4uLookup = { kind: "hit"; lyrics: string; query: string } | { kind: "miss"; failure: Tab4uFailure | null };

export interface Tab4uSearchResult {
  href: string;
  title: string;
  artist: string;
}

type PageOutcome =
  | { kind: "ok"; body: string }
  | { kind: "not_found" }
  | { kind: "skipped" }
  | { kind: Tab4uFailure; detail: string; blocked: boolean };

const BASE_URL = "https://www.tab4u.com/";
const USER_AGENT = "karaoke-worker/0.2 (self hosted party karaoke)";
const MAX_SEARCHES = 2;
const MIN_LYRIC_LINES = 4;
const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 30 * 60_000;
const MIN_FUZZY_TITLE_LENGTH = 6;
const HEBREW_LETTER = /[א-ת]/;
const BLOCK_STATUSES = new Set([403, 429, 503]);
const CHALLENGE_MARKERS =
  /captcha|cf-chl|challenge-platform|cf-browser-verification|just a moment\.\.\.|attention required|access denied|ddos-guard|perimeterx|incapsula|turnstile/i;
const RESULT_LINK = /<a\b[^>]*\bhref="(tabs\/songs\/\d+_[^"?#/]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
const RESULT_TITLE = /class="sNameI19"[^>]*>([\s\S]*?)<\/div>/i;
const RESULT_ARTIST = /class="aNameI19"[^>]*>([\s\S]*?)<\/div>/i;
const SONG_CELL = /<td\b[^>]*\bclass=["']song["'][^>]*>([\s\S]*?)<\/td>/gi;
const SECTION_TITLE_CELL = /class=["']titLine["']/i;
const SECTION_LABEL = /^\S+(?:\s\S+)?\s*:$/;
const CHORD_TOKEN = /^(?:\|+|[A-G][#b]?(?:maj|min|m|dim|aug|sus|add|\d|[#b+-])*(?:\/[A-G][#b]?)?)$/;
const TAB_ROW = /^[A-Ga-g]?\s*\|?[-\d|hpbrx/\\~ ]{8,}\|?$/;
const BRACKETED = /\([^()]*\)|\[[^\]]*\]/g;
const NAMED_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", lrm: "", rlm: "" };

const health = { nextSlotAt: 0, consecutiveFailures: 0, openUntil: 0 };

export function resetTab4uState(): void {
  Object.assign(health, { nextSlotAt: 0, consecutiveFailures: 0, openUntil: 0 });
}

export function hasHebrew(text: string | null | undefined): boolean {
  return HEBREW_LETTER.test(text ?? "");
}

export async function lookupTab4u(candidates: LyricsCandidate[], deadlineAt: number, log: LyricsLogger): Promise<Tab4uLookup> {
  for (const query of searchQueries(candidates)) {
    const label = `tab4u search q="${query}"`;
    const page = await tab4uGet(searchUrl(query), label, deadlineAt, log);
    if (page.kind === "skipped") return { kind: "miss", failure: null };
    if ("detail" in page) return { kind: "miss", failure: page.kind };
    if (page.kind !== "ok") continue;
    const picked = pickTab4uResult(parseSearchResults(page.body), candidates);
    if (picked) return fetchSongLyrics(picked, label, deadlineAt, log);
    log(`lyrics tab4u no confident title and artist match for q="${query}"`);
  }
  return { kind: "miss", failure: null };
}

async function fetchSongLyrics(
  picked: Tab4uSearchResult,
  searchLabel: string,
  deadlineAt: number,
  log: LyricsLogger,
): Promise<Tab4uLookup> {
  const label = `tab4u song "${picked.artist}" / "${picked.title}"`;
  const page = await tab4uGet(new URL(picked.href, BASE_URL), label, deadlineAt, log);
  if ("detail" in page) return { kind: "miss", failure: page.kind };
  const lyrics = page.kind === "ok" ? parseSongLyrics(page.body) : null;
  if (!lyrics) {
    log(`lyrics tab4u page had no usable lyric lines for ${label}`);
    return { kind: "miss", failure: null };
  }
  return { kind: "hit", lyrics, query: `${searchLabel} -> ${label}` };
}

export function searchQueries(candidates: LyricsCandidate[]): string[] {
  const hebrewFirst = [...candidates]
    .filter((c) => hasHebrew(c.track))
    .sort((a, b) => Number(hasHebrew(b.artist)) - Number(hasHebrew(a.artist)));
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of hebrewFirst) {
    const query = hebrewQuery(candidate);
    const key = words(query).sort().join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries.slice(0, MAX_SEARCHES);
}

function hebrewQuery(candidate: LyricsCandidate): string {
  const text = candidate.kind === "title" ? candidate.track : `${candidate.artist} ${candidate.track}`;
  const hebrewWords = text.split(/s+/).filter(hasHebrew);
  return [...new Set(hebrewWords)].join(" ");
}

function searchUrl(query: string): URL {
  const url = new URL("resultsSimple", BASE_URL);
  url.searchParams.set("tab", "songs");
  url.searchParams.set("q", query);
  return url;
}

export function parseSearchResults(html: string): Tab4uSearchResult[] {
  const results: Tab4uSearchResult[] = [];
  const seen = new Set<string>();
  for (const [, href, inner] of html.matchAll(RESULT_LINK)) {
    const title = cellText(RESULT_TITLE.exec(inner)?.[1] ?? "").replace(/\s*\/\s*$/, "");
    const artist = cellText(RESULT_ARTIST.exec(inner)?.[1] ?? "");
    if (!title || !artist || seen.has(href)) continue;
    seen.add(href);
    results.push({ href, title, artist });
  }
  return results;
}

export function pickTab4uResult(results: Tab4uSearchResult[], candidates: LyricsCandidate[]): Tab4uSearchResult | null {
  const pairMatch = results.find((result) =>
    candidates.some((c) => titlesMatch(result.title, c.track) && artistsMatch(result.artist, c.artist)),
  );
  return pairMatch ?? results.find((result) => candidates.some((c) => coversWholeTitle(result, c.track))) ?? null;
}

export function coversWholeTitle(result: Tab4uSearchResult, youtubeTitle: string): boolean {
  const titleWords = words(result.title.replace(BRACKETED, " "));
  const artistWords = words(result.artist);
  if (titleWords.length === 0 || artistWords.length === 0) return false;
  const named = new Set([...artistWords, ...titleWords]);
  const heard = words(youtubeTitle);
  const hebrewHeard = heard.filter(hasHebrew);
  return [...named].every((word) => heard.includes(word)) && hebrewHeard.every((word) => named.has(word));
}

export function titlesMatch(found: string, wanted: string): boolean {
  const a = titleKey(found);
  const b = titleKey(wanted);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < MIN_FUZZY_TITLE_LENGTH) return false;
  return editDistance(a, b) <= (Math.max(a.length, b.length) >= 12 ? 2 : 1);
}

export function artistsMatch(found: string, wanted: string): boolean {
  const a = words(found);
  const b = words(wanted);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === 1) return shorter[0] === longer[0];
  return shorter.every((word) => longer.includes(word));
}

function titleKey(text: string): string {
  return words(text.replace(BRACKETED, " ")).join("");
}

function words(text: string): string[] {
  return text.split(/\s+/).map(normalizeToken).filter(Boolean);
}

export function parseSongLyrics(html: string): string | null {
  const start = html.indexOf('id="songContentTPL"');
  if (start < 0) return null;
  const end = html.indexOf('id="ratingWrap"', start);
  const content = html.slice(start, end < 0 ? undefined : end);
  const stanzas = content
    .split(/<\/table>/i)
    .map(stanzaLines)
    .filter((lines) => lines.length > 0);
  if (stanzas.flat().length < MIN_LYRIC_LINES) return null;
  return stanzas.map((lines) => lines.join("\n")).join("\n\n");
}

function stanzaLines(tableHtml: string): string[] {
  return [...tableHtml.matchAll(SONG_CELL)]
    .map(([, cell]) => cell)
    .filter((cell) => !SECTION_TITLE_CELL.test(cell))
    .map((cell) => cellText(cell).replace(/\s*\.{2,}\s*/g, " ").trim())
    .filter(isLyricLine);
}

function isLyricLine(line: string): boolean {
  if (!/\p{L}/u.test(line) || SECTION_LABEL.test(line) || TAB_ROW.test(line)) return false;
  return !line.split(/\s+/).every((token) => CHORD_TOKEN.test(token));
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  });
}

async function tab4uGet(url: URL, label: string, deadlineAt: number, log: LyricsLogger): Promise<PageOutcome> {
  if (Date.now() < health.openUntil) {
    log(`lyrics skipped ${label}: Tab4U circuit breaker open`);
    return { kind: "skipped" };
  }
  const waitMs = reserveSlot(deadlineAt);
  if (waitMs === null) {
    log(`lyrics skipped ${label}: lookup deadline reached`);
    return { kind: "skipped" };
  }
  if (waitMs > 0) await sleep(waitMs);
  const outcome = await fetchPage(url, Math.min(env.TAB4U_TIMEOUT_MS, deadlineAt - Date.now()));
  recordHealth(outcome, label, log);
  return outcome;
}

function reserveSlot(deadlineAt: number): number | null {
  const now = Date.now();
  const slotAt = Math.max(now, health.nextSlotAt);
  if (slotAt >= deadlineAt) return null;
  health.nextSlotAt = slotAt + env.TAB4U_MIN_INTERVAL_MS;
  return slotAt - now;
}

async function fetchPage(url: URL, timeoutMs: number): Promise<PageOutcome> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    return await toPageOutcome(response);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { kind: "timeout", detail: `no response within ${timeoutMs}ms`, blocked: false };
    }
    return { kind: "network_error", detail: err instanceof Error ? err.message : String(err), blocked: false };
  }
}

async function toPageOutcome(response: Response): Promise<PageOutcome> {
  if (BLOCK_STATUSES.has(response.status)) return blockedPage(`HTTP ${response.status}`);
  if (response.status === 404) return { kind: "not_found" };
  if (!response.ok) return { kind: "http_error", detail: `HTTP ${response.status}`, blocked: false };
  if (response.url && new URL(response.url).host !== new URL(BASE_URL).host) {
    return blockedPage(`redirected to ${new URL(response.url).host}`);
  }
  const body = await response.text();
  return CHALLENGE_MARKERS.test(body) ? blockedPage("challenge or block page") : { kind: "ok", body };
}

function blockedPage(detail: string): PageOutcome {
  return { kind: "rate_limited", detail, blocked: true };
}

function recordHealth(outcome: PageOutcome, label: string, log: LyricsLogger): void {
  if (!("detail" in outcome)) {
    health.consecutiveFailures = 0;
    return;
  }
  log(`lyrics ${outcome.kind} for ${label}: ${outcome.detail}`);
  health.consecutiveFailures += 1;
  if (outcome.blocked || health.consecutiveFailures >= BREAKER_THRESHOLD) openBreaker(outcome.kind, log);
}

function openBreaker(kind: Tab4uFailure, log: LyricsLogger): void {
  health.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  health.consecutiveFailures = 0;
  log(`lyrics Tab4U disabled for ${BREAKER_COOLDOWN_MS / 60_000} minutes (${kind})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
