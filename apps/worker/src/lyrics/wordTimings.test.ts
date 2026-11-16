import { describe, expect, it } from "vitest";
import type { LyricsWordTimings } from "@karaoke/shared";
import type { TranscriptWord } from "./tokens.js";
import { MAX_WORD_SECONDS, buildWordTimings, interpolateUnmatched, settleSpans } from "./wordTimings.js";

function sung(text: string, start: number, step = 0.5): TranscriptWord[] {
  return text.split(" ").map((w, i) => ({ text: ` ${w}`, start: start + i * step, end: start + i * step + step * 0.8, probability: 0.9 }));
}

function expectWellFormed(timings: LyricsWordTimings, lineStarts: number[]): void {
  timings.forEach((line, i) => {
    const next = lineStarts.find((t) => t > lineStarts[i]) ?? Number.POSITIVE_INFINITY;
    let floor = line.start;
    for (const word of line.words) {
      expect(word.start).toBeGreaterThanOrEqual(floor);
      expect(word.end).toBeGreaterThanOrEqual(word.start);
      expect(word.end).toBeLessThanOrEqual(next);
      floor = word.end;
    }
  });
}

const LRC = "[00:10.00]paper boats on the river\n[00:14.00]\n[00:20.00]lanterns in the rain";

describe("buildWordTimings", () => {
  it("times matched words from the transcript", () => {
    const timings = buildWordTimings(LRC, [...sung("paper boats on the river", 10.2), ...sung("lanterns in the rain", 20.1)])!;
    expect(timings).toHaveLength(3);
    expect(timings[0].words.map((w) => w.text)).toEqual(["paper", "boats", "on", "the", "river"]);
    expect(timings[0].words[0]).toEqual({ text: "paper", start: 10.2, end: 10.6 });
    expect(timings[0].words[4]).toEqual({ text: "river", start: 12.2, end: 12.6 });
    expect(timings[1]).toEqual({ start: 14, end: 14, words: [] });
    expect(timings[2].words[0].start).toBeCloseTo(20.1);
    expectWellFormed(timings, [10, 14, 20]);
  });

  it("interpolates unmatched words between matched neighbours", () => {
    const heard = sung("paper boats xx yy river", 10);
    const [line] = buildWordTimings(LRC, heard)!;
    expect(line.words[1].end).toBeCloseTo(0.4 + 10.5);
    expect(line.words[2].start).toBeCloseTo(line.words[1].end);
    expect(line.words[3].end).toBeCloseTo(line.words[4].start);
    expect(line.words[2].end).toBeLessThanOrEqual(line.words[3].start);
  });

  it("keeps repeated words in order", () => {
    const lrc = "[00:05.00]la la la la\n[00:09.00]end";
    const [line] = buildWordTimings(lrc, [...sung("la la la la", 5.1, 0.6), ...sung("end", 9.1)])!;
    const starts = line.words.map((w) => w.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(4);
  });

  it("leaves a line Whisper missed to the estimate", () => {
    const timings = buildWordTimings(LRC, sung("lanterns in the rain", 20.1))!;
    expect(timings[0]).toEqual({ start: 10, end: 14, words: [] });
    expect(timings[2].words).toHaveLength(4);
  });

  it("does not borrow words sung inside another line's window", () => {
    const lrc = "[00:10.00]paper boats\n[00:14.00]paper boats";
    const timings = buildWordTimings(lrc, sung("paper boats", 14.2))!;
    expect(timings[0].words).toEqual([]);
    expect(timings[1].words[0].start).toBeCloseTo(14.2);
  });

  it("clamps early words to the line start and late words before the next line", () => {
    const lrc = "[00:10.00]paper boats\n[00:12.00]rain";
    const heard = [
      { text: "paper", start: 9.7, end: 10.5, probability: 0.9 },
      { text: "boats", start: 11.5, end: 13.5, probability: 0.9 },
      { text: "rain", start: 12.1, end: 12.6, probability: 0.9 },
    ];
    const timings = buildWordTimings(lrc, heard)!;
    expect(timings[0].words[0].start).toBe(10);
    expect(timings[0].words[1].end).toBe(12);
    expectWellFormed(timings, [10, 12]);
  });

  it("bounds the last line by the song duration", () => {
    const lrc = "[00:50.00]goodbye now";
    const heard = [
      { text: "goodbye", start: 50.1, end: 50.6, probability: 0.9 },
      { text: "now", start: 50.7, end: 58, probability: 0.9 },
    ];
    const [line] = buildWordTimings(lrc, heard, 52)!;
    expect(line.words[1].end).toBe(52);
    expect(line.end).toBe(52);
  });

  it("follows the web's order for repeated timestamps", () => {
    const lrc = "[00:20.00][00:05.00]echo echo\n[00:10.00]middle";
    const timings = buildWordTimings(lrc, [...sung("echo echo", 5), ...sung("middle", 10), ...sung("echo echo", 20)])!;
    expect(timings.map((l) => l.start)).toEqual([5, 10, 20]);
    expect(timings.every((l) => l.words.length > 0)).toBe(true);
  });

  it("returns nothing when no line could be timed", () => {
    expect(buildWordTimings(LRC, sung("completely different words here", 40))).toBeNull();
    expect(buildWordTimings(LRC, [])).toBeNull();
    expect(buildWordTimings("no timestamps", sung("paper", 1))).toBeNull();
  });

  it("times Hebrew words with the shared token matching", () => {
    const lrc = "[00:03.00]שמש על הגג\n[00:07.00]x";
    const [line] = buildWordTimings(lrc, sung("שמש על הגג", 3.1))!;
    expect(line.words.map((w) => w.text)).toEqual(["שמש", "על", "הגג"]);
    expect(line.words[2].start).toBeCloseTo(4.1);
  });
});

describe("span helpers", () => {
  const window = { start: 10, end: 14 };

  it("spreads a leading unmatched run from the line start", () => {
    const spans = interpolateUnmatched(["aa", "bbbb", "c"], [null, null, { start: 13, end: 13.5 }], window);
    expect(spans[0]).toEqual({ start: 10, end: 11 });
    expect(spans[1]).toEqual({ start: 11, end: 13 });
  });

  it("gives a trailing unmatched run a short span inside the window", () => {
    const spans = interpolateUnmatched(["a", "b"], [{ start: 10, end: 13.8 }, null], window);
    expect(spans[1].start).toBe(13.8);
    expect(spans[1].end).toBe(14);
  });

  it("keeps settled spans monotonic, bounded and short", () => {
    const settled = settleSpans([{ start: 9, end: 9.5 }, { start: 9.2, end: 20 }, { start: 11, end: 11.2 }], { start: 10, end: 30 });
    expect(settled[0]).toEqual({ start: 10, end: 10 });
    expect(settled[1]).toEqual({ start: 10, end: 10 + MAX_WORD_SECONDS });
    expect(settled[2].start).toBe(15);
    expect(settled[2].end).toBe(15);
  });
});

describe("review cases", () => {
  it("does not reuse a token the previous line matched at a shared boundary", () => {
    const lrc = "[00:10.00]run run\n[00:11.00]run away\n[00:15.00]x";
    const heard = [
      { text: " run", start: 10.1, end: 10.4, probability: 0.9 },
      { text: " run", start: 10.6, end: 10.9, probability: 0.9 },
      { text: " run", start: 11.3, end: 11.6, probability: 0.9 },
      { text: " away", start: 11.7, end: 12.2, probability: 0.9 },
    ];
    const timings = buildWordTimings(lrc, heard)!;
    expect(timings[0].words.map((w) => w.start)).toEqual([10.1, 10.6]);
    expect(timings[1].words[0]).toEqual({ text: "run", start: 11.3, end: 11.6 });
  });

  it("ignores words without letters when deciding whether a line is usable", () => {
    const lrc = "[00:10.00]♪ ♪ paper ♪\n[00:14.00]x";
    const [line] = buildWordTimings(lrc, sung("paper", 11))!;
    expect(line.words.map((w) => w.text)).toEqual(["♪", "♪", "paper", "♪"]);
    expect(line.words[2].start).toBeCloseTo(11);
    expectWellFormed([line], [10, 14]);
  });

  it("leaves an oversize line untimed instead of dropping the whole song", () => {
    const long = "あ".repeat(210);
    const lrc = `[00:05.00]${long}\n[00:10.00]paper boats`;
    const timings = buildWordTimings(lrc, [{ text: long.slice(0, 20), start: 5.1, end: 6, probability: 0.9 }, ...sung("paper boats", 10.2)])!;
    expect(timings[0].words).toEqual([]);
    expect(timings[1].words).toHaveLength(2);
  });

  it("leaves a line with more words than the stored limit untimed", () => {
    const many = Array.from({ length: 201 }, () => "la").join(" ");
    const timings = buildWordTimings(`[00:05.00]${many}\n[00:30.00]paper boats`, [...sung(many, 5, 0.1), ...sung("paper boats", 30.2)])!;
    expect(timings[0].words).toEqual([]);
    expect(timings[1].words).toHaveLength(2);
  });
});
