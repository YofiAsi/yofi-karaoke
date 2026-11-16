// Transcribes the vocals stem for every song: Whisper lines when nothing was found, alignment for plain text, word timings for synced lines.
import type { LyricsWordTimings } from "@karaoke/shared";
import { env } from "../env.js";
import type { GpuPriority } from "../gpu/index.js";
import { alignLyrics } from "../lyrics/align.js";
import { buildLines } from "../lyrics/lineBuilder.js";
import { buildWordTimings } from "../lyrics/wordTimings.js";
import { toLrc, type TranscriptWord } from "../lyrics/tokens.js";
import type { LyricsLogger, LyricsResult, LyricsSource } from "./lyrics.js";
import { needsRomaji } from "./romaji.js";
import { languageHint, transcribeVocals } from "./transcribe.js";

export type TimedLyricsPlan = "transcribe" | "align" | "words";

export interface TimedLyrics {
  lyrics: LyricsResult;
  words: TranscriptWord[] | null;
}

export interface SongNames {
  title: string;
  track?: string | null;
}

const MIN_GENERATED_LINES = 3;
const UNVERIFIED_PLAIN_SOURCES: ReadonlySet<LyricsSource> = new Set(["tab4u"]);

function withoutPlainLyrics(lyrics: LyricsResult): LyricsResult {
  return { ...lyrics, plainLyrics: null, source: "none", missReason: "not_found", matchedQuery: null };
}

export function planTimedLyrics(lyrics: Pick<LyricsResult, "syncedLyrics" | "plainLyrics">): TimedLyricsPlan {
  if (lyrics.syncedLyrics?.trim()) return "words";
  return lyrics.plainLyrics?.trim() ? "align" : "transcribe";
}

export function applyTranscript(lyrics: LyricsResult, words: TranscriptWord[], log: LyricsLogger): LyricsResult {
  const plan = planTimedLyrics(lyrics);
  if (plan === "align") return applyAlignment(lyrics, words, log);
  if (plan === "transcribe") return applyGeneratedLines(lyrics, words, log);
  return lyrics;
}

function applyAlignment(lyrics: LyricsResult, words: TranscriptWord[], log: LyricsLogger): LyricsResult {
  const result = alignLyrics(lyrics.plainLyrics ?? "", words);
  if (!result.ok && UNVERIFIED_PLAIN_SOURCES.has(lyrics.source)) {
    log(`alignment rejected ${lyrics.source} lyrics as a likely wrong song, dropping them: ${result.reason}`);
    return applyGeneratedLines(withoutPlainLyrics(lyrics), words, log);
  }
  if (!result.ok) {
    log(`alignment rejected, keeping plain lyrics: ${result.reason}`);
    return lyrics;
  }
  log(`aligned ${result.lines.length} lines, ${Math.round(result.matchRate * 100)}% of words matched`);
  const source = lyrics.source === "manual" ? "manual" : "aligned";
  return { ...lyrics, syncedLyrics: toLrc(result.lines), source, missReason: null };
}

function applyGeneratedLines(lyrics: LyricsResult, words: TranscriptWord[], log: LyricsLogger): LyricsResult {
  const lines = buildLines(words);
  if (lines.length < MIN_GENERATED_LINES) {
    log(`transcript gave only ${lines.length} usable lines; keeping no lyrics`);
    return lyrics;
  }
  log(`generated ${lines.length} lines from ${words.length} transcribed words`);
  return { ...lyrics, syncedLyrics: toLrc(lines), plainLyrics: null, source: "whisper", missReason: null };
}

export function transcriptionEnabled(): boolean {
  return env.TRANSCRIBE_BACKEND !== "none";
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 500) : String(err);
}

export function untimed(lyrics: LyricsResult): TimedLyrics {
  return { lyrics, words: null };
}

export function transcribeTimeoutMs(plan: TimedLyricsPlan): number {
  return plan === "words" ? env.WORD_TIMINGS_TIMEOUT_MS : env.TRANSCRIBE_TIMEOUT_MS;
}

function skipReason(lyrics: LyricsResult, plan: TimedLyricsPlan, vocalsPath: string | null): string | null {
  if (!vocalsPath) return "timed lyrics skipped: no vocals stem";
  if (plan === "words" && needsRomaji(lyrics)) return "word timings skipped: the lyrics will be romanized";
  return null;
}

export async function addTimedLyrics(
  song: SongNames,
  lyrics: LyricsResult,
  vocalsPath: string | null,
  log: LyricsLogger,
  priority: GpuPriority,
): Promise<TimedLyrics> {
  if (!transcriptionEnabled()) return untimed(lyrics);
  const plan = planTimedLyrics(lyrics);
  const skip = skipReason(lyrics, plan, vocalsPath);
  if (skip || !vocalsPath) {
    log(skip ?? "timed lyrics skipped");
    return untimed(lyrics);
  }
  try {
    const transcript = await transcribeVocals(vocalsPath, languageHint(song.title, song.track), priority, transcribeTimeoutMs(plan));
    log(`transcribed ${transcript.words.length} words language=${transcript.language} device=${transcript.device} in ${transcript.wallMs}ms after ${transcript.queuedMs}ms in the GPU lane`);
    return { lyrics: applyTranscript(lyrics, transcript.words, log), words: transcript.words };
  } catch (err) {
    log(`timed lyrics failed, keeping existing lyrics: ${describeError(err)}`);
    return untimed(lyrics);
  }
}

export function wordTimingsFor(
  saved: LyricsResult,
  timed: TimedLyrics,
  durationSeconds: number,
  log: LyricsLogger,
): LyricsWordTimings | null {
  if (!saved.syncedLyrics || !timed.words) return null;
  if (saved.syncedLyrics !== timed.lyrics.syncedLyrics) {
    log("word timings left to the estimate: line text changed after transcription");
    return null;
  }
  try {
    const timings = buildWordTimings(saved.syncedLyrics, timed.words, durationSeconds);
    const timedLines = timings?.filter((line) => line.words.length > 0).length ?? 0;
    log(`word timings for ${timedLines} of ${timings?.length ?? 0} lines`);
    return timings;
  } catch (err) {
    log(`word timings failed, leaving them to the estimate: ${describeError(err)}`);
    return null;
  }
}
