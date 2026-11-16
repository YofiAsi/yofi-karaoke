// Turns timed transcript words into karaoke sized LRC lines and drops typical Whisper hallucinations.
import {
  hasUnspacedScript,
  isUnspacedChar,
  lineUnits,
  normalizeToken,
  type TimedLine,
  type TranscriptWord,
} from "./tokens.js";

const PAUSE_SECONDS = 0.7;
const MIN_UNITS = 3;
const MAX_UNITS = 8;
const MERGE_GAP_SECONDS = 1.5;
const ISOLATION_SECONDS = 4;
const ISOLATED_MAX_UNITS = 4;
const ISOLATED_MIN_PROBABILITY = 0.5;
const MIN_GROUP_PROBABILITY = 0.2;
const STRETCHED_WORD_SECONDS = 2.5;
const STRETCHED_MIN_PROBABILITY = 0.6;
const MIN_LINE_STEP_SECONDS = 0.1;
const SENTENCE_END = /[.!?…。！？]$/;
const CLAUSE_END = /[,;:،、，]$/;

const CREDIT_PATTERNS = [
  /subtitles? (by|from)/,
  /captions? by/,
  /transcri(bed|ption) by/,
  /amara ?org/,
  /thanks? (you )?for watching/,
  /please subscribe/,
  /תודה (רבה )?שצפיתם/,
  /כתוביות/,
  /תורגם|תרגום/,
  /ご視聴ありがとうございました/,
  /字幕/,
  /チャンネル登録/,
];

interface Repeat {
  size: number;
  minRepeats: number;
  keep: number;
}

const REPEAT_RULES: Repeat[] = [
  ...[8, 7, 6, 5, 4, 3].map((size) => ({ size, minRepeats: 4, keep: 2 })),
  ...[2, 1].map((size) => ({ size, minRepeats: 6, keep: 3 })),
];

type Group = TranscriptWord[];

export function buildLines(words: TranscriptWord[]): TimedLine[] {
  const usable = collapseRepeats(words.filter(isUsableWord));
  const groups = mergeShortGroups(splitLongGroups(splitAtPauses(usable)));
  return toTimedLines(groups.filter((group, i) => !isHallucination(group, groups[i - 1], groups[i + 1])));
}

function isUsableWord(word: TranscriptWord): boolean {
  return normalizeToken(word.text).length > 0 && Number.isFinite(word.start) && word.end >= word.start;
}

function wordKey(word: TranscriptWord): string {
  return normalizeToken(word.text);
}

function sameRun(words: TranscriptWord[], a: number, b: number, size: number): boolean {
  for (let k = 0; k < size; k += 1) {
    if (wordKey(words[a + k]) !== wordKey(words[b + k])) return false;
  }
  return true;
}

function countRepeats(words: TranscriptWord[], at: number, size: number): number {
  let repeats = 1;
  while (at + (repeats + 1) * size <= words.length && sameRun(words, at, at + repeats * size, size)) repeats += 1;
  return repeats;
}

function collapseOnce(words: TranscriptWord[], rule: Repeat): TranscriptWord[] {
  const kept: TranscriptWord[] = [];
  let i = 0;
  while (i < words.length) {
    const repeats = i + rule.size <= words.length ? countRepeats(words, i, rule.size) : 1;
    if (repeats >= rule.minRepeats) {
      kept.push(...words.slice(i, i + rule.keep * rule.size));
      i += repeats * rule.size;
    } else {
      kept.push(words[i]);
      i += 1;
    }
  }
  return kept;
}

export function collapseRepeats(words: TranscriptWord[]): TranscriptWord[] {
  return REPEAT_RULES.reduce(collapseOnce, words);
}

function splitAtPauses(words: TranscriptWord[]): Group[] {
  const groups: Group[] = [];
  let current: Group = [];
  for (const word of words) {
    if (current.length > 0 && endsGroup(current, word)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function endsGroup(current: Group, next: TranscriptWord): boolean {
  const last = current[current.length - 1];
  const lastText = last.text.trim();
  if (next.start - last.end >= PAUSE_SECONDS) return true;
  const units = groupUnits(current);
  if (SENTENCE_END.test(lastText) && units >= MIN_UNITS) return true;
  return CLAUSE_END.test(lastText) && units >= MIN_UNITS + 2;
}

function splitLongGroups(groups: Group[]): Group[] {
  return groups.flatMap(splitLongGroup);
}

function splitLongGroup(group: Group): Group[] {
  if (groupUnits(group) <= MAX_UNITS || group.length < 2) return [group];
  const cut = bestCut(group);
  return [...splitLongGroup(group.slice(0, cut)), ...splitLongGroup(group.slice(cut))];
}

function bestCut(group: Group): number {
  const total = groupUnits(group);
  let best = Math.ceil(group.length / 2);
  let bestScore = -Infinity;
  for (let cut = 1; cut < group.length; cut += 1) {
    const left = groupUnits(group.slice(0, cut));
    const score = cutScore(group, cut, left, total);
    if (score > bestScore) {
      bestScore = score;
      best = cut;
    }
  }
  return best;
}

function cutScore(group: Group, cut: number, left: number, total: number): number {
  const before = group[cut - 1];
  const gap = group[cut].start - before.end;
  const punctuation = SENTENCE_END.test(before.text.trim()) ? 1 : CLAUSE_END.test(before.text.trim()) ? 0.5 : 0;
  const balance = 1 - Math.abs(total - 2 * left) / total;
  const tooSmall = left < MIN_UNITS || total - left < MIN_UNITS ? 1 : 0;
  return gap * 2 + punctuation + balance - tooSmall * 2;
}

function mergeShortGroups(groups: Group[]): Group[] {
  const result = [...groups];
  for (let i = 0; i < result.length; i += 1) {
    if (groupUnits(result[i]) >= MIN_UNITS) continue;
    const target = mergeTarget(result, i);
    if (target === null) continue;
    const [first, second] = target < i ? [target, i] : [i, target];
    result.splice(first, 2, [...result[first], ...result[second]]);
    i = first - 1;
  }
  return result;
}

function mergeTarget(groups: Group[], i: number): number | null {
  const options = [i - 1, i + 1]
    .filter((j) => j >= 0 && j < groups.length)
    .filter((j) => groupUnits(groups[i]) + groupUnits(groups[j]) <= MAX_UNITS)
    .map((j) => ({ j, gap: gapBetween(groups, Math.min(i, j)) }))
    .filter((option) => option.gap < MERGE_GAP_SECONDS)
    .sort((a, b) => a.gap - b.gap);
  return options[0]?.j ?? null;
}

function gapBetween(groups: Group[], first: number): number {
  return groupStart(groups[first + 1]) - groupEnd(groups[first]);
}

function isHallucination(group: Group, previous: Group | undefined, next: Group | undefined): boolean {
  const probability = meanProbability(group);
  if (isCredit(group) || probability < MIN_GROUP_PROBABILITY) return true;
  if (meanWordSeconds(group) > STRETCHED_WORD_SECONDS && probability < STRETCHED_MIN_PROBABILITY) return true;
  return isIsolated(group, previous, next) && groupUnits(group) <= ISOLATED_MAX_UNITS && probability < ISOLATED_MIN_PROBABILITY;
}

function isIsolated(group: Group, previous: Group | undefined, next: Group | undefined): boolean {
  const before = previous ? groupStart(group) - groupEnd(previous) : Infinity;
  const after = next ? groupStart(next) - groupEnd(group) : Infinity;
  return before >= ISOLATION_SECONDS && after >= ISOLATION_SECONDS;
}

function isCredit(group: Group): boolean {
  const plain = joinWords(group).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return CREDIT_PATTERNS.some((pattern) => pattern.test(plain));
}

function meanProbability(group: Group): number {
  return group.reduce((sum, word) => sum + word.probability, 0) / group.length;
}

function meanWordSeconds(group: Group): number {
  return group.reduce((sum, word) => sum + (word.end - word.start), 0) / group.length;
}

function groupStart(group: Group): number {
  return group[0].start;
}

function groupEnd(group: Group): number {
  return group[group.length - 1].end;
}

function groupUnits(group: Group): number {
  return lineUnits(joinWords(group));
}

function needsSpace(before: string, raw: string): boolean {
  if (before.length === 0) return false;
  if (/^\s/.test(raw)) return true;
  const last = before[before.length - 1];
  const first = raw.trim()[0] ?? "";
  return !isUnspacedChar(last) && !isUnspacedChar(first) && !hasUnspacedScript(raw);
}

export function joinWords(words: TranscriptWord[]): string {
  return words.reduce((text, word) => text + (needsSpace(text, word.text) ? " " : "") + word.text.trim(), "");
}

function toTimedLines(groups: Group[]): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const group of groups) {
    const text = joinWords(group).trim();
    if (!text) continue;
    const previous = lines[lines.length - 1];
    const start = previous ? Math.max(groupStart(group), previous.start + MIN_LINE_STEP_SECONDS) : groupStart(group);
    lines.push({ start, text });
  }
  return lines;
}
