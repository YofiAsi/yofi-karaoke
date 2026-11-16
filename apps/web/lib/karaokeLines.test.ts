import { describe, expect, it } from "vitest";
import type { LyricsWordTimings } from "@karaoke/shared";
import {
  MAX_ESTIMATED_SECONDS_PER_CHAR,
  buildKaraokeLines,
  hasSungLines,
  estimateWords,
  estimatedLineEnd,
  timingsMatchLines,
} from "./karaokeLines";

const LINES = [
  { time: 10, text: "שמש על הגג" },
  { time: 14, text: "" },
  { time: 20, text: "paper boats tonight" },
];

const TIMINGS: LyricsWordTimings = [
  {
    start: 10,
    end: 12.5,
    words: [
      { text: "שמש", start: 10, end: 10.8 },
      { text: "על", start: 10.9, end: 11.3 },
      { text: "הגג", start: 11.4, end: 12.5 },
    ],
  },
  { start: 14, end: 14, words: [] },
  {
    start: 20,
    end: 22,
    words: [
      { text: "paper", start: 20, end: 20.6 },
      { text: "boats", start: 20.7, end: 21.2 },
      { text: "tonight", start: 21.3, end: 22 },
    ],
  },
];

describe("timingsMatchLines", () => {
  it("accepts timings with the same line count and words", () => {
    expect(timingsMatchLines(LINES, TIMINGS)).toBe(true);
  });

  it("rejects a different line count", () => {
    expect(timingsMatchLines(LINES, TIMINGS.slice(0, 2))).toBe(false);
  });

  it("rejects timings that describe other text", () => {
    const other = structuredClone(TIMINGS);
    other[2].words[1].text = "planes";
    expect(timingsMatchLines(LINES, other)).toBe(false);
  });

  it("rejects absent timings", () => {
    expect(timingsMatchLines(LINES, null)).toBe(false);
  });

  it("treats a line without words as left to the estimate", () => {
    const partial = structuredClone(TIMINGS);
    partial[0].words = [];
    expect(timingsMatchLines(LINES, partial)).toBe(true);
  });
});

describe("estimate", () => {
  it("splits a line across its words in proportion to their length", () => {
    const words = estimateWords(["ab", "abcd"], 0, 6);
    expect(words).toEqual([
      { text: "ab", start: 0, end: 2 },
      { text: "abcd", start: 2, end: 6 },
    ]);
  });

  it("ends a line before the next one", () => {
    expect(estimatedLineEnd(10, 12, "a long line of words")).toBeCloseTo(11.8);
  });

  it("caps the fill by text length before a long instrumental gap", () => {
    const end = estimatedLineEnd(10, 60, "ab cd");
    expect(end).toBeCloseTo(10 + 4 * MAX_ESTIMATED_SECONDS_PER_CHAR);
  });
});

describe("buildKaraokeLines", () => {
  it("uses stored timings when they match and drops empty lines", () => {
    const lines = buildKaraokeLines(LINES, TIMINGS, 30);
    expect(lines.map((l) => l.lrcIndex)).toEqual([0, 2]);
    expect(lines.every((l) => l.timed)).toBe(true);
    expect(lines[1].words[2]).toEqual({ text: "tonight", start: 21.3, end: 22 });
  });

  it("falls back to the estimate on a mismatch", () => {
    const lines = buildKaraokeLines(LINES, TIMINGS.slice(1), 30);
    expect(lines.every((l) => !l.timed)).toBe(true);
    expect(lines[0].start).toBe(10);
    expect(lines[0].end).toBeLessThanOrEqual(14);
    expect(lines[0].words.map((w) => w.text)).toEqual(["שמש", "על", "הגג"]);
  });

  it("estimates only the lines marked untimed", () => {
    const partial = structuredClone(TIMINGS);
    partial[0].words = [];
    const lines = buildKaraokeLines(LINES, partial, 30);
    expect(lines.map((l) => l.timed)).toEqual([false, true]);
  });

  it("keeps estimated words monotonic and inside the line", () => {
    const [line] = buildKaraokeLines([{ time: 5, text: "one two three four" }, { time: 9, text: "x" }], null);
    line.words.forEach((word, i) => {
      expect(word.start).toBeGreaterThanOrEqual(line.start);
      expect(word.end).toBeLessThanOrEqual(line.end + 1e-9);
      if (i > 0) expect(word.start).toBeCloseTo(line.words[i - 1].end);
    });
  });

  it("bounds the last line by the song duration", () => {
    const lines = buildKaraokeLines([{ time: 100, text: "a very long closing line indeed" }], null, 102);
    expect(lines[0].end).toBeCloseTo(101.8);
  });
});

describe("hasSungLines", () => {
  it("is false for an LRC whose lines are all empty", () => {
    expect(hasSungLines([{ time: 1, text: "" }, { time: 4, text: "   " }])).toBe(false);
    expect(hasSungLines([{ time: 1, text: "" }, { time: 4, text: "la" }])).toBe(true);
  });
});
