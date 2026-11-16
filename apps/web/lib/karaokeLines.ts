// Builds the sung lines of the karaoke display with word times: stored timings when they match the LRC text, else a length based estimate.
import { splitLyricWords, type LyricsWordTimings, type TimedLine } from "@karaoke/shared";
import type { LrcLine } from "./lrc";

export const ESTIMATE_GAP_SHARE = 0.9;
export const MAX_ESTIMATED_SECONDS_PER_CHAR = 0.3;

export interface KaraokeWord {
  text: string;
  start: number;
  end: number;
}

export interface KaraokeLine {
  lrcIndex: number;
  text: string;
  start: number;
  end: number;
  words: KaraokeWord[];
  timed: boolean;
}

export const splitWords = splitLyricWords;

export function hasSungLines(lines: readonly LrcLine[]): boolean {
  return lines.some((line) => splitWords(line.text).length > 0);
}

function charCount(text: string): number {
  return [...text.replace(/\s+/g, "")].length;
}

function isUntimedMarker(timed: TimedLine): boolean {
  return timed.words.length === 0;
}

function sameWords(text: string, timed: TimedLine): boolean {
  if (isUntimedMarker(timed)) return true;
  const words = splitWords(text);
  return words.length === timed.words.length && words.every((word, i) => word === timed.words[i].text);
}

export function timingsMatchLines(
  lines: readonly LrcLine[],
  timings: LyricsWordTimings | null | undefined,
): timings is LyricsWordTimings {
  if (!timings || timings.length !== lines.length) return false;
  return lines.every((line, i) => sameWords(line.text, timings[i]));
}

function nextBoundary(lines: readonly LrcLine[], index: number, durationSeconds: number | undefined): number | null {
  const start = lines[index].time;
  const later = lines.slice(index + 1).find((line) => line.time > start);
  if (later) return later.time;
  return durationSeconds && durationSeconds > start ? durationSeconds : null;
}

export function estimatedLineEnd(start: number, boundary: number | null, text: string): number {
  const byLength = charCount(text) * MAX_ESTIMATED_SECONDS_PER_CHAR;
  const byGap = boundary === null ? Number.POSITIVE_INFINITY : Math.max(0, boundary - start) * ESTIMATE_GAP_SHARE;
  return start + Math.min(byLength, byGap);
}

export function estimateWords(words: readonly string[], start: number, end: number): KaraokeWord[] {
  const weights = words.map((word) => Math.max(1, [...word].length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0, end - start);
  let consumed = 0;
  return words.map((text, i) => {
    const wordStart = start + (consumed / total) * duration;
    consumed += weights[i];
    return { text, start: wordStart, end: start + (consumed / total) * duration };
  });
}

function timedLine(line: LrcLine, index: number, timed: TimedLine): KaraokeLine {
  const words = timed.words.map(({ text, start, end }) => ({ text, start, end }));
  return { lrcIndex: index, text: line.text, start: line.time, end: timed.end, words, timed: true };
}

function estimatedLine(lines: readonly LrcLine[], index: number, durationSeconds: number | undefined): KaraokeLine {
  const line = lines[index];
  const end = estimatedLineEnd(line.time, nextBoundary(lines, index, durationSeconds), line.text);
  const words = estimateWords(splitWords(line.text), line.time, end);
  return { lrcIndex: index, text: line.text, start: line.time, end, words, timed: false };
}

export function buildKaraokeLines(
  lines: readonly LrcLine[],
  timings: LyricsWordTimings | null | undefined,
  durationSeconds?: number,
): KaraokeLine[] {
  const usable = timingsMatchLines(lines, timings) ? timings : null;
  return lines.flatMap((line, index) => {
    if (splitWords(line.text).length === 0) return [];
    const timed = usable?.[index];
    if (timed && !isUntimedMarker(timed)) return [timedLine(line, index, timed)];
    return [estimatedLine(lines, index, durationSeconds)];
  });
}
