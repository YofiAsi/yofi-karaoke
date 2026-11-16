import { describe, expect, it } from "vitest";
import { activeLineIndex } from "./lyricsTiming";

const LINES = [
  { time: 5, text: "one" },
  { time: 10, text: "two" },
  { time: 15, text: "three" },
];

describe("activeLineIndex", () => {
  it("has no active line before the first one", () => {
    expect(activeLineIndex(LINES, 1, 0)).toBe(-1);
  });

  it("activates a line slightly ahead of its time", () => {
    expect(activeLineIndex(LINES, 9.8, 0)).toBe(1);
    expect(activeLineIndex(LINES, 9.6, 0)).toBe(0);
  });

  it("shows lyrics later for a positive offset", () => {
    expect(activeLineIndex(LINES, 10, 1000)).toBe(0);
  });
});
