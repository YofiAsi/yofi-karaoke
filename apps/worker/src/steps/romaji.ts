// Rewrites Japanese lyrics as Hepburn romaji after alignment, keeping LRC timestamps and the original text on any failure.
import { env } from "../env.js";
import type { LyricsLogger, LyricsResult } from "./lyrics.js";
import { runRomanizer } from "./romanizer.js";

const KANA = /[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]/;
const LRC_TIMESTAMPS = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+\s*)(.*)$/;
const LRC_TAG = /^\[[a-z]+:.*\]$/i;

export type LyricsText = Pick<LyricsResult, "syncedLyrics" | "plainLyrics">;

interface LrcLine {
  prefix: string;
  text: string;
}

export function romajiEnabled(): boolean {
  return env.LYRICS_ROMAJI_ENABLED === true;
}

export function isJapanese(text: string | null | undefined): boolean {
  return Boolean(text && KANA.test(text));
}

export function needsRomaji(lyrics: LyricsText): boolean {
  return romajiEnabled() && (isJapanese(lyrics.syncedLyrics) || isJapanese(lyrics.plainLyrics));
}

export function splitLrcLine(line: string): LrcLine {
  if (LRC_TAG.test(line.trim())) return { prefix: line, text: "" };
  const match = LRC_TIMESTAMPS.exec(line);
  return match ? { prefix: match[1], text: match[2] } : { prefix: "", text: line };
}

function linesOf(text: string | null): string[] {
  return text === null ? [] : text.split(/\r?\n/);
}

function rebuildLrc(lines: LrcLine[], texts: string[]): string {
  return lines.map((line, index) => line.prefix + texts[index]).join("\n");
}

function describeError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

async function convertLyrics(lyrics: LyricsResult, log: LyricsLogger): Promise<LyricsResult> {
  const synced = linesOf(lyrics.syncedLyrics).map(splitLrcLine);
  const plain = linesOf(lyrics.plainLyrics);
  const started = Date.now();
  const { lines, failed } = await runRomanizer([...synced.map((line) => line.text), ...plain]);
  const kept = failed > 0 ? `, ${failed} kept in Japanese script after errors` : "";
  log(`romanized ${lines.length} lyric lines in ${Date.now() - started}ms${kept}`);
  return {
    ...lyrics,
    syncedLyrics: lyrics.syncedLyrics === null ? null : rebuildLrc(synced, lines.slice(0, synced.length)),
    plainLyrics: lyrics.plainLyrics === null ? null : lines.slice(synced.length).join("\n"),
  };
}

export async function romanizeLyrics(lyrics: LyricsResult, log: LyricsLogger): Promise<LyricsResult> {
  if (!needsRomaji(lyrics)) return lyrics;
  try {
    return await convertLyrics(lyrics, log);
  } catch (err) {
    log(`romaji conversion failed, keeping the Japanese lyrics: ${describeError(err)}`);
    return lyrics;
  }
}
