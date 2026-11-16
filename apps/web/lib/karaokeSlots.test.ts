import { describe, expect, it } from "vitest";
import type { KaraokeLine } from "./karaokeLines";
import { COUNTDOWN_GAP_SECONDS, GAP_HOLD_SECONDS, countdownDots, pivotIndex, slotContents } from "./karaokeSlots";

function line(start: number, end: number): KaraokeLine {
  return { lrcIndex: 0, text: "la la", start, end, words: [], timed: false };
}

const LINES = [line(10, 13), line(14, 17), line(18, 21), line(40, 43), line(44, 47)];

function shown(time: number) {
  return slotContents(LINES, time).map((slot) => (slot ? `${slot.lineIndex}:${slot.role}` : null));
}

describe("slotContents", () => {
  it("shows the first two lines before singing starts", () => {
    expect(shown(0)).toEqual(["0:current", "1:next"]);
  });

  it("alternates lines between the two slots", () => {
    expect(shown(11)).toEqual(["0:current", "1:next"]);
    expect(shown(15)).toEqual(["2:next", "1:current"]);
    expect(shown(19)).toEqual(["2:current", "3:next"]);
  });

  it("keeps a finished line until the next one starts", () => {
    expect(shown(13.5)).toEqual(["0:current", "1:next"]);
  });

  it("switches a slot exactly when the following line starts", () => {
    expect(shown(13.999)).toEqual(["0:current", "1:next"]);
    expect(shown(14)).toEqual(["2:next", "1:current"]);
  });

  it("moves on to the upcoming pair during a long instrumental gap", () => {
    expect(40 - 21).toBeGreaterThanOrEqual(COUNTDOWN_GAP_SECONDS);
    expect(pivotIndex(LINES, 21 + GAP_HOLD_SECONDS - 0.01)).toBe(2);
    expect(shown(21 + GAP_HOLD_SECONDS)).toEqual(["4:next", "3:current"]);
  });

  it("leaves the other slot empty on the last line", () => {
    expect(shown(45)).toEqual(["4:current", null]);
  });

  it("shows nothing without lines", () => {
    expect(slotContents([], 5)).toEqual([null, null]);
  });
});

describe("countdownDots", () => {
  it("counts down the last seconds before the first line", () => {
    expect(countdownDots(LINES, 6.9)).toBeNull();
    expect(countdownDots(LINES, 7)).toBe(3);
    expect(countdownDots(LINES, 8.5)).toBe(2);
    expect(countdownDots(LINES, 9.5)).toBe(1);
    expect(countdownDots(LINES, 10)).toBeNull();
  });

  it("counts down after a long instrumental gap", () => {
    expect(countdownDots(LINES, 30)).toBeNull();
    expect(countdownDots(LINES, 37.5)).toBe(3);
    expect(countdownDots(LINES, 39.2)).toBe(1);
  });

  it("stays hidden between lines that follow closely", () => {
    expect(countdownDots(LINES, 13.5)).toBeNull();
    expect(countdownDots(LINES, 43.5)).toBeNull();
  });

  it("shows the remaining dots when the first line starts early", () => {
    expect(countdownDots([line(1.5, 3)], 0)).toBe(2);
  });

  it("stops after the last line", () => {
    expect(countdownDots(LINES, 50)).toBeNull();
  });
});

describe("lines that start together", () => {
  const DUET = [line(10, 13), line(10, 12.5), line(15, 17), line(18, 20)];

  function duetShown(time: number) {
    return slotContents(DUET, time).map((slot) => (slot ? `${slot.lineIndex}:${slot.role}` : null));
  }

  it("shows both lines of a shared start as current", () => {
    expect(duetShown(10.5)).toEqual(["0:current", "1:current"]);
    expect(duetShown(12.8)).toEqual(["0:current", "1:current"]);
  });

  it("moves on line by line once each one is finished", () => {
    expect(duetShown(13.2)).toEqual(["2:next", "1:current"]);
    expect(duetShown(15.5)).toEqual(["2:current", "3:next"]);
  });

  it("shows the pair before it starts", () => {
    expect(duetShown(5)).toEqual(["0:current", "1:current"]);
  });
});
