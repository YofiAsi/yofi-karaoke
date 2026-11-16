// Gives every reference lyrics line a start time by matching its words in order against transcript words.
import { tokenize, tokenSimilarity, type TimedLine, type TranscriptWord } from "./tokens.js";

export type AlignResult =
  | { ok: true; lines: TimedLine[]; matchRate: number; anchoredLines: number }
  | { ok: false; reason: string; matchRate: number; anchoredLines: number };

interface RefToken {
  token: string;
  line: number;
  position: number;
}

interface TimedToken {
  token: string;
  start: number;
}

interface Anchor {
  start: number;
  lastMatch: number;
}

const MIN_SIMILARITY = 0.6;
const MIN_MATCH_RATE = 0.35;
const MIN_ANCHORED_FRACTION = 0.5;
const MIN_LINE_MATCH_FRACTION = 0.3;
const MIN_LINE_STEP_SECONDS = 0.1;
const LINE_SPAN_SLACK_SECONDS = 2;
const LINE_SPAN_TOKEN_FACTOR = 3;
const LRC_TIMESTAMP = /^(\s*\[\d+:\d+(?:\.\d+)?\])+/;
const REPEAT_MARKER = /\s*[([]?\s*[x×]\s*\d+\s*[)\]]?\s*$/i;
const SECTION_LABEL = /^\s*[[(]?\s*(intro|outro|verse|chorus|pre-?chorus|bridge|hook|refrain|פזמון|בית|מעבר|גשר)(?!\p{L})[\s\d]{0,3}[\])]?\s*:?\s*$/iu;
const BRACKETED_LABEL = /^\s*\[[^\]]*\]\s*$/;

export function referenceLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LRC_TIMESTAMP, "").replace(REPEAT_MARKER, "").trim())
    .filter((line) => line.length > 0 && !SECTION_LABEL.test(line) && !BRACKETED_LABEL.test(line))
    .filter((line) => tokenize(line).length > 0);
}

function refTokens(lines: string[]): RefToken[] {
  return lines.flatMap((line, index) => tokenize(line).map((token, position) => ({ token, line: index, position })));
}

export function timedTokens(words: TranscriptWord[]): TimedToken[] {
  return words.flatMap((word) => {
    const tokens = tokenize(word.text);
    const step = (word.end - word.start) / Math.max(1, tokens.length);
    return tokens.map((token, k) => ({ token, start: word.start + step * k }));
  });
}

function matchWeight(ref: string, heard: string): number {
  const similarity = tokenSimilarity(ref, heard);
  if (similarity < MIN_SIMILARITY) return 0;
  return similarity * (0.5 + Math.min(ref.length, 6) / 12);
}

export function matchTokens(ref: string[], heard: string[]): Map<number, number> {
  const cols = heard.length + 1;
  const score = new Float32Array((ref.length + 1) * cols);
  const move = new Uint8Array((ref.length + 1) * cols);
  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= heard.length; j += 1) {
      const up = score[(i - 1) * cols + j];
      const left = score[i * cols + j - 1];
      const weight = matchWeight(ref[i - 1], heard[j - 1]);
      const diagonal = weight > 0 ? score[(i - 1) * cols + j - 1] + weight : -1;
      const best = Math.max(up, left, diagonal);
      score[i * cols + j] = best;
      move[i * cols + j] = best === diagonal ? 2 : best === up ? 1 : 0;
    }
  }
  return backtrack(move, ref.length, heard.length, cols);
}

function backtrack(move: Uint8Array, rows: number, columns: number, cols: number): Map<number, number> {
  const matches = new Map<number, number>();
  let i = rows;
  let j = columns;
  while (i > 0 && j > 0) {
    const step = move[i * cols + j];
    if (step === 2) matches.set(i - 1, j - 1);
    if (step !== 0) i -= 1;
    if (step !== 1) j -= 1;
  }
  return matches;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function secondsPerToken(words: TranscriptWord[]): number {
  const perToken = words.map((w) => (w.end - w.start) / Math.max(1, tokenize(w.text).length));
  return Math.min(0.6, Math.max(0.15, median(perToken)));
}

interface LineMatch {
  position: number;
  time: number;
}

function lineMatches(refs: RefToken[], matches: Map<number, number>, heard: TimedToken[], lineCount: number): LineMatch[][] {
  const perLine: LineMatch[][] = Array.from({ length: lineCount }, () => []);
  refs.forEach((ref, index) => {
    const heardIndex = matches.get(index);
    if (heardIndex !== undefined) perLine[ref.line].push({ position: ref.position, time: heard[heardIndex].start });
  });
  return perLine;
}

function coherent(matched: LineMatch[], tokenCount: number, perToken: number): LineMatch[] {
  const center = median(matched.map((m) => m.time));
  const limit = LINE_SPAN_SLACK_SECONDS + tokenCount * perToken * LINE_SPAN_TOKEN_FACTOR;
  return matched.filter((m) => Math.abs(m.time - center) <= limit);
}

function isTrusted(matched: LineMatch[], tokenCount: number): boolean {
  return matched.length >= Math.min(2, tokenCount) && matched.length / tokenCount >= MIN_LINE_MATCH_FRACTION;
}

function anchorLine(matched: LineMatch[], tokenCount: number, perToken: number, floor: number): Anchor | null {
  const kept = coherent(matched, tokenCount, perToken);
  if (!isTrusted(kept, tokenCount)) return null;
  const first = kept[0];
  const lastMatch = kept[kept.length - 1].time;
  return { start: Math.max(first.time - first.position * perToken, floor), lastMatch };
}

function anchorLines(perLine: LineMatch[][], tokenCounts: number[], perToken: number): (Anchor | null)[] {
  let floor = 0;
  return perLine.map((matched, line) => {
    const anchor = anchorLine(matched, tokenCounts[line], perToken, floor);
    if (anchor) floor = anchor.lastMatch;
    return anchor;
  });
}

function interpolate(anchors: (Anchor | null)[], tokenCounts: number[], perToken: number): number[] {
  const starts = anchors.map((anchor) => anchor?.start ?? NaN);
  const anchored = starts.flatMap((start, line) => (Number.isNaN(start) ? [] : [line]));
  fillBefore(starts, tokenCounts, anchored[0], perToken);
  for (let k = 0; k + 1 < anchored.length; k += 1) fillBetween(starts, tokenCounts, anchored[k], anchored[k + 1]);
  fillAfter(starts, tokenCounts, anchored[anchored.length - 1], perToken);
  return starts;
}

function fillBefore(starts: number[], tokenCounts: number[], firstAnchor: number, perToken: number): void {
  let time = starts[firstAnchor];
  for (let line = firstAnchor - 1; line >= 0; line -= 1) {
    time = Math.max(0, time - tokenCounts[line] * perToken * 1.5);
    starts[line] = time;
  }
}

function fillBetween(starts: number[], tokenCounts: number[], from: number, to: number): void {
  const weights = tokenCounts.slice(from, to);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let done = 0;
  for (let line = from + 1; line < to; line += 1) {
    done += tokenCounts[line - 1];
    starts[line] = starts[from] + ((starts[to] - starts[from]) * done) / total;
  }
}

function fillAfter(starts: number[], tokenCounts: number[], lastAnchor: number, perToken: number): void {
  for (let line = lastAnchor + 1; line < starts.length; line += 1) {
    starts[line] = starts[line - 1] + tokenCounts[line - 1] * perToken * 1.5;
  }
}

function strictlyIncreasing(starts: number[]): number[] {
  const result: number[] = [];
  for (const start of starts) {
    const previous = result[result.length - 1];
    result.push(previous === undefined ? start : Math.max(start, previous + MIN_LINE_STEP_SECONDS));
  }
  return result;
}

export function alignLyrics(referenceText: string, words: TranscriptWord[]): AlignResult {
  const lines = referenceLines(referenceText);
  const refs = refTokens(lines);
  const heard = timedTokens(words);
  if (refs.length === 0 || heard.length === 0) {
    return { ok: false, reason: "nothing to align", matchRate: 0, anchoredLines: 0 };
  }

  const matches = matchTokens(refs.map((r) => r.token), heard.map((h) => h.token));
  const tokenCounts = lines.map((line) => tokenize(line).length);
  const perToken = secondsPerToken(words);
  const anchors = anchorLines(lineMatches(refs, matches, heard, lines.length), tokenCounts, perToken);
  const matchRate = matches.size / refs.length;
  const anchoredLines = anchors.filter(Boolean).length;

  if (matchRate < MIN_MATCH_RATE || anchoredLines / lines.length < MIN_ANCHORED_FRACTION) {
    const reason = `only ${Math.round(matchRate * 100)}% of words and ${anchoredLines}/${lines.length} lines matched`;
    return { ok: false, reason, matchRate, anchoredLines };
  }
  const starts = strictlyIncreasing(interpolate(anchors, tokenCounts, perToken));
  return { ok: true, lines: lines.map((text, i) => ({ start: starts[i], text })), matchRate, anchoredLines };
}
