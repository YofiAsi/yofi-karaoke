// Fills in synced lyrics from the vocals stem: Whisper lines when nothing was found, alignment when only plain text exists.
import { env } from "../env.js";
import type { GpuPriority } from "../gpu/index.js";
import { alignLyrics } from "../lyrics/align.js";
import { buildLines } from "../lyrics/lineBuilder.js";
import { toLrc, type TranscriptWord } from "../lyrics/tokens.js";
import type { LyricsLogger, LyricsResult, LyricsSource } from "./lyrics.js";
import { languageHint, transcribeVocals } from "./transcribe.js";

export type TimedLyricsPlan = "transcribe" | "align" | "skip";

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
  if (lyrics.syncedLyrics?.trim()) return "skip";
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

export async function addTimedLyrics(
  song: SongNames,
  lyrics: LyricsResult,
  vocalsPath: string | null,
  log: LyricsLogger,
  priority: GpuPriority,
): Promise<LyricsResult> {
  if (!transcriptionEnabled() || planTimedLyrics(lyrics) === "skip") return lyrics;
  if (!vocalsPath) {
    log("timed lyrics skipped: no vocals stem");
    return lyrics;
  }
  try {
    const transcript = await transcribeVocals(vocalsPath, languageHint(song.title, song.track), priority);
    log(`transcribed ${transcript.words.length} words language=${transcript.language} device=${transcript.device} in ${transcript.wallMs}ms after ${transcript.queuedMs}ms in the GPU lane`);
    return applyTranscript(lyrics, transcript.words, log);
  } catch (err) {
    log(`timed lyrics failed, keeping existing lyrics: ${err instanceof Error ? err.message.slice(0, 500) : String(err)}`);
    return lyrics;
  }
}
