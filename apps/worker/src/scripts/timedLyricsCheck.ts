// Manual QA: compares Whisper lines and aligned lines against LRCLIB synced lyrics for one transcript.
// Usage: tsx src/scripts/timedLyricsCheck.ts --transcript <transcribe.py json> [--lrc <synced lrc>] [--plain <plain text>]
import { readFileSync } from "node:fs";
import { alignLyrics, matchTokens, timedTokens } from "../lyrics/align.js";
import { buildLines } from "../lyrics/lineBuilder.js";
import { parseLrcLines, tokenize, toLrc, type TimedLine, type TranscriptWord } from "../lyrics/tokens.js";

interface Transcript {
  language: string;
  durationSeconds: number;
  words: TranscriptWord[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readOptional(path: string | undefined): string | null {
  return path ? readFileSync(path, "utf8").trim() || null : null;
}

function stats(errors: number[]): string {
  if (errors.length === 0) return "n=0";
  const sorted = errors.map(Math.abs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const within = (limit: number) => sorted.filter((e) => e <= limit).length;
  const top = sorted.slice(-3).reverse().map((e) => e.toFixed(2)).join(",");
  return `n=${sorted.length} median=${median.toFixed(2)}s worst3=${top}s within0.5s=${within(0.5)} within1s=${within(1)}`;
}

function lineTokenOwners(lines: TimedLine[]): { line: number; position: number }[] {
  return lines.flatMap((line, index) => tokenize(line.text).map((_, position) => ({ line: index, position })));
}

function compareGenerated(generated: TimedLine[], reference: TimedLine[], words: TranscriptWord[]): void {
  const refOwners = lineTokenOwners(reference);
  const heard = timedTokens(words);
  const refTokens = reference.flatMap((line) => tokenize(line.text));
  const matches = matchTokens(refTokens, heard.map((h) => h.token));
  const heardToRef = new Map([...matches].map(([ref, heardIndex]) => [heardIndex, ref]));
  console.log(`word match rate (LRCLIB words heard): ${((matches.size / refTokens.length) * 100).toFixed(1)}% of ${refTokens.length}`);

  const firstHeard = (line: TimedLine) => {
    const first = tokenize(line.text)[0];
    return heard.findIndex((h) => h.start >= line.start - 0.2 && h.token === first);
  };
  const errors: number[] = [];
  generated.map(firstHeard).forEach((heardIndex, line) => {
    const ref = heardToRef.get(heardIndex);
    if (ref === undefined || refOwners[ref].position !== 0) return;
    errors.push(generated[line].start - reference[refOwners[ref].line].start);
  });
  console.log(`generated line starts that begin a LRCLIB line: ${stats(errors)}`);
}

function compareAligned(reference: TimedLine[], words: TranscriptWord[]): void {
  const result = alignLyrics(reference.map((line) => line.text).join("\n"), words);
  console.log(`alignment ok=${result.ok} matchRate=${(result.matchRate * 100).toFixed(1)}% anchored=${result.anchoredLines}/${reference.length}`);
  if (!result.ok) {
    console.log(`alignment rejected: ${result.reason}`);
    return;
  }
  if (result.lines.length !== reference.length) {
    console.log(`alignment returned ${result.lines.length} lines for ${reference.length} reference lines; skipping timing`);
    return;
  }
  console.log(`aligned line start error vs LRCLIB: ${stats(result.lines.map((line, i) => line.start - reference[i].start))}`);
}

function matchByText(aligned: TimedLine[], reference: TimedLine[]): number[] {
  const errors: number[] = [];
  let cursor = 0;
  for (const line of aligned) {
    const found = reference.findIndex((ref, i) => i >= cursor && ref.text.trim() === line.text.trim());
    if (found < 0) continue;
    errors.push(line.start - reference[found].start);
    cursor = found + 1;
  }
  return errors;
}

function compareAlignedPlain(plain: string, reference: TimedLine[], words: TranscriptWord[]): void {
  const result = alignLyrics(plain, words);
  console.log(`LRCLIB plain alignment ok=${result.ok} matchRate=${(result.matchRate * 100).toFixed(1)}% anchored=${result.anchoredLines}`);
  if (result.ok) console.log(`LRCLIB plain aligned start error vs LRCLIB synced: ${stats(matchByText(result.lines, reference))}`);
}

function main(): void {
  const transcript = JSON.parse(readFileSync(argValue("--transcript") ?? "", "utf8")) as Transcript;
  const lrc = readOptional(argValue("--lrc"));
  const plain = readOptional(argValue("--plain"));
  const generated = buildLines(transcript.words);
  console.log(`language=${transcript.language} duration=${transcript.durationSeconds}s words=${transcript.words.length} lines=${generated.length}`);
  console.log(toLrc(generated.slice(0, 8)));

  if (lrc) {
    const reference = parseLrcLines(lrc).filter((line) => tokenize(line.text).length > 0);
    compareGenerated(generated, reference, transcript.words);
    compareAligned(reference, transcript.words);
    if (plain) compareAlignedPlain(plain, reference, transcript.words);
  }
  if (plain && !lrc) {
    const result = alignLyrics(plain, transcript.words);
    console.log(`plain alignment ok=${result.ok} matchRate=${(result.matchRate * 100).toFixed(1)}% anchored=${result.anchoredLines}`);
    if (result.ok) console.log(toLrc(result.lines.slice(0, 8)));
  }
}

main();
