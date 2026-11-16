// LRC parser: accepts [m:ss], [mm:ss.x] to [mm:ss.xxx], [mm:ss:xx] and repeated timestamps per line.

export interface LrcLine {
  time: number;
  text: string;
}

const LEADING_TIMESTAMPS = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIMESTAMP = /<[\d:.]+>/g;

export function parseLrc(lrc: string | null | undefined): LrcLine[] {
  if (!lrc) return [];
  const lines = lrc.split(/\r?\n/).flatMap(parseLine);
  return lines.sort((a, b) => a.time - b.time);
}

function parseLine(rawLine: string): LrcLine[] {
  const line = rawLine.trim();
  const prefix = line.match(LEADING_TIMESTAMPS)?.[0];
  if (!prefix) return [];
  const text = line.slice(prefix.length).replace(WORD_TIMESTAMP, "");
  return [...prefix.matchAll(TIMESTAMP)].map((m) => ({ time: toSeconds(m[1], m[2], m[3]), text }));
}

function toSeconds(minutes: string, seconds: string, fraction: string | undefined): number {
  const fractional = fraction ? Number(fraction) / 10 ** fraction.length : 0;
  return roundMs(Number(minutes) * 60 + Number(seconds) + fractional);
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
