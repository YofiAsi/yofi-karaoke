// Word normalization, tokenization and LRC formatting shared by the line builder and the aligner.

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  probability: number;
}

export interface TimedLine {
  start: number;
  text: string;
}

const NIQQUD_AND_MARKS = /[֑-ׇ̀-ͯ]/g;
const FINAL_LETTERS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const UNSPACED_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}ー]/u;

export function normalizeToken(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(NIQQUD_AND_MARKS, "")
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c])
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isUnspacedChar(char: string): boolean {
  return UNSPACED_CHAR.test(char);
}

export function hasUnspacedScript(text: string): boolean {
  return UNSPACED_SCRIPT.test(text);
}

function splitChunk(chunk: string): string[] {
  if (!hasUnspacedScript(chunk)) return [chunk];
  const parts: string[] = [];
  let latin = "";
  for (const char of chunk) {
    if (isUnspacedChar(char)) {
      if (latin) parts.push(latin);
      latin = "";
      parts.push(char);
    } else {
      latin += char;
    }
  }
  if (latin) parts.push(latin);
  return parts;
}

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap(splitChunk)
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

export function lineUnits(text: string): number {
  return text
    .split(/\s+/)
    .filter((chunk) => normalizeToken(chunk).length > 0)
    .reduce((sum, chunk) => sum + chunkUnits(chunk), 0);
}

function chunkUnits(chunk: string): number {
  const unspaced = [...chunk].filter(isUnspacedChar).length;
  return unspaced === 0 ? 1 : Math.max(1, Math.round(unspaced / 2.5));
}

export function editDistance(a: string, b: string): number {
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

export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 3) return 0;
  return 1 - editDistance(a, b) / longest;
}

export function formatLrcTime(seconds: number): string {
  const centis = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(centis / 6000);
  const secs = Math.floor((centis % 6000) / 100);
  const rest = centis % 100;
  return `${pad(minutes)}:${pad(secs)}.${pad(rest)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLrc(lines: TimedLine[]): string {
  return lines.map((line) => `[${formatLrcTime(line.start)}]${line.text}`).join("\n");
}

export function parseLrcLines(lrc: string): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const match = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(raw.trim());
    if (!match) continue;
    lines.push({ start: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() });
  }
  return lines;
}
