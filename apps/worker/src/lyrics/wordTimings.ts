// Times each word of synced lyrics from the transcript: token matching inside the line's window, interpolation for unmatched words.
import {
  LyricsWordTimingsSchema,
  parseLrc,
  splitLyricWords,
  type LrcLine,
  type LyricsWordTimings,
  type TimedLine,
  type TimedWord,
} from "@karaoke/shared";
import { matchTokens } from "./align.js";
import { tokenize, type TranscriptWord } from "./tokens.js";

export const WINDOW_LEAD_SECONDS = 0.5;
export const LAST_LINE_SECONDS = 10;
export const MIN_LINE_MATCH_FRACTION = 0.5;
export const MAX_WORD_SECONDS = 5;
export const TRAILING_WORD_SECONDS = 0.5;

interface HeardToken {
  token: string;
  start: number;
  end: number;
}

interface Span {
  start: number;
  end: number;
}

interface LineWindow {
  start: number;
  end: number;
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function heardTokens(words: readonly TranscriptWord[]): HeardToken[] {
  return words.flatMap((word) => {
    const tokens = tokenize(word.text);
    const step = Math.max(0, word.end - word.start) / Math.max(1, tokens.length);
    return tokens.map((token, k) => ({ token, start: word.start + step * k, end: word.start + step * (k + 1) }));
  });
}

export function lineWindows(lines: readonly LrcLine[], durationSeconds?: number): LineWindow[] {
  return lines.map((line, index) => {
    const later = lines.slice(index + 1).find((next) => next.time > line.time);
    if (later) return { start: line.time, end: later.time };
    const songEnd = durationSeconds && durationSeconds > line.time ? durationSeconds : Number.POSITIVE_INFINITY;
    return { start: line.time, end: Math.min(songEnd, line.time + LAST_LINE_SECONDS) };
  });
}

function tokensInWindow(heard: readonly HeardToken[], window: LineWindow): HeardToken[] {
  return heard.filter((token) => token.start >= window.start - WINDOW_LEAD_SECONDS && token.start < window.end);
}

function widen(span: Span | null, token: HeardToken): Span {
  return span ? { start: Math.min(span.start, token.start), end: Math.max(span.end, token.end) } : { start: token.start, end: token.end };
}

export function matchWords(words: readonly string[], heard: readonly HeardToken[]): (Span | null)[] {
  const refs = words.flatMap((word, index) => tokenize(word).map((token) => ({ token, index })));
  const matches = matchTokens(refs.map((ref) => ref.token), heard.map((token) => token.token));
  const spans: (Span | null)[] = words.map(() => null);
  refs.forEach((ref, i) => {
    const heardIndex = matches.get(i);
    if (heardIndex !== undefined) spans[ref.index] = widen(spans[ref.index], heard[heardIndex]);
  });
  return spans;
}

function charWeight(word: string): number {
  return Math.max(1, [...word].length);
}

function spread(words: readonly string[], from: number, to: number): Span[] {
  const weights = words.map(charWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0, to - from);
  let consumed = 0;
  return weights.map((weight) => {
    const start = from + (consumed / total) * duration;
    consumed += weight;
    return { start, end: from + (consumed / total) * duration };
  });
}

function runBounds(spans: readonly (Span | null)[], first: number, last: number, window: LineWindow, length: number): Span {
  const before = first > 0 ? spans[first - 1] : null;
  const after = last + 1 < spans.length ? spans[last + 1] : null;
  const from = before ? before.end : window.start;
  if (after) return { start: from, end: after.start };
  return { start: from, end: Math.min(window.end, from + length * TRAILING_WORD_SECONDS) };
}

export function interpolateUnmatched(words: readonly string[], spans: readonly (Span | null)[], window: LineWindow): Span[] {
  const filled: (Span | null)[] = [...spans];
  let index = 0;
  while (index < filled.length) {
    if (filled[index]) {
      index += 1;
      continue;
    }
    let last = index;
    while (last + 1 < filled.length && !filled[last + 1]) last += 1;
    const bounds = runBounds(spans, index, last, window, last - index + 1);
    spread(words.slice(index, last + 1), bounds.start, bounds.end).forEach((span, k) => (filled[index + k] = span));
    index = last + 1;
  }
  return filled as Span[];
}

export function settleSpans(spans: readonly Span[], window: LineWindow): Span[] {
  let floor = window.start;
  return spans.map((span) => {
    const start = Math.min(Math.max(span.start, floor), window.end);
    const end = Math.min(Math.max(span.end, start), window.end, start + MAX_WORD_SECONDS);
    floor = end;
    return { start: roundMs(start), end: roundMs(end) };
  });
}

function untimedLine(line: LrcLine, window: LineWindow): TimedLine {
  return { start: line.time, end: roundMs(Math.max(line.time, Math.min(window.end, line.time + LAST_LINE_SECONDS))), words: [] };
}

function isUsable(spans: readonly (Span | null)[]): boolean {
  const matched = spans.filter(Boolean).length;
  return matched > 0 && matched / spans.length >= MIN_LINE_MATCH_FRACTION;
}

export function timeLine(line: LrcLine, window: LineWindow, heard: readonly HeardToken[]): TimedLine {
  const words = splitLyricWords(line.text);
  if (words.length === 0) return { start: line.time, end: line.time, words: [] };
  const spans = matchWords(words, tokensInWindow(heard, window));
  if (!isUsable(spans)) return untimedLine(line, window);
  const settled = settleSpans(interpolateUnmatched(words, spans, window), window);
  const timedWords: TimedWord[] = words.map((text, i) => ({ text, ...settled[i] }));
  return { start: line.time, end: Math.max(line.time, settled[settled.length - 1].end), words: timedWords };
}

export function buildWordTimings(
  lrc: string,
  transcript: readonly TranscriptWord[],
  durationSeconds?: number,
): LyricsWordTimings | null {
  const lines = parseLrc(lrc);
  if (lines.length === 0 || transcript.length === 0) return null;
  const heard = heardTokens(transcript);
  const windows = lineWindows(lines, durationSeconds);
  const timings = lines.map((line, i) => timeLine(line, windows[i], heard));
  if (!timings.some((line) => line.words.length > 0)) return null;
  return LyricsWordTimingsSchema.parse(timings);
}
