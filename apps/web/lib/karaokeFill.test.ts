import { describe, expect, it } from "vitest";
import type { KaraokeLine } from "./karaokeLines";
import { fillStyle, lineDirection, lineFills, wordDirection, wordFill } from "./karaokeFill";
import { fillTime, lyricsTime, readLivePosition } from "./livePosition";
import { LOOKAHEAD_SECONDS } from "./lyricsTiming";
import { clockFromState, type PositionClock } from "./positionClock";

const LINE: KaraokeLine = {
  lrcIndex: 0,
  text: "גשם דק",
  start: 10,
  end: 12,
  words: [
    { text: "גשם", start: 10, end: 11 },
    { text: "דק", start: 11, end: 12 },
  ],
  timed: true,
};

describe("direction", () => {
  it("reads Hebrew lines as right to left and Latin lines as left to right", () => {
    expect(lineDirection("גשם דק")).toBe("rtl");
    expect(lineDirection("soft rain")).toBe("ltr");
  });

  it("decides mixed lines by the first strong letter", () => {
    expect(lineDirection("…גשם on the roof")).toBe("rtl");
    expect(lineDirection("2 soft גשם")).toBe("ltr");
  });

  it("falls back to left to right when there is no letter", () => {
    expect(lineDirection("123 !")).toBe("ltr");
  });

  it("gives each word its own direction and neutral words the line direction", () => {
    expect(wordDirection("rain", "rtl")).toBe("ltr");
    expect(wordDirection("גשם", "ltr")).toBe("rtl");
    expect(wordDirection("42!", "rtl")).toBe("rtl");
  });
});

describe("wordFill", () => {
  it("fills word by word and continuously inside a word", () => {
    expect(lineFills(LINE, 9.9)).toEqual([0, 0]);
    expect(lineFills(LINE, 10.25)).toEqual([0.25, 0]);
    expect(lineFills(LINE, 11.5)).toEqual([1, 0.5]);
    expect(lineFills(LINE, 12)).toEqual([1, 1]);
  });

  it("fills a zero length word at once", () => {
    expect(wordFill({ text: "x", start: 3, end: 3 }, 2.99)).toBe(0);
    expect(wordFill({ text: "x", start: 3, end: 3 }, 3)).toBe(1);
  });
});

describe("fill across playback", () => {
  const playing = {
    currentQueueItemId: "item",
    positionSeconds: 10,
    isPlaying: true,
    hostUserId: "h",
    playerUserId: "h",
    vocalsGain: 0,
  };

  function fillAt(clock: PositionClock, nowMs: number): number[] {
    const position = readLivePosition({ clock, reader: null, fallbackSeconds: 0 }, nowMs);
    return lineFills(LINE, fillTime(position, 0));
  }

  it("advances with the clock while playing", () => {
    const clock = clockFromState(null, playing, 0);
    expect(fillAt(clock, 500)).toEqual([0.5, 0]);
  });

  it("stops while paused", () => {
    const clock = clockFromState(clockFromState(null, playing, 0), { ...playing, isPlaying: false, positionSeconds: 10.5 }, 500);
    expect(fillAt(clock, 600)).toEqual([0.5, 0]);
    expect(fillAt(clock, 5000)).toEqual([0.5, 0]);
  });

  it("jumps on a seek", () => {
    const before = clockFromState(null, { ...playing, positionSeconds: 3 }, 0);
    const clock = clockFromState(before, { ...playing, positionSeconds: 11.75 }, 100);
    expect(fillAt(clock, 100)).toEqual([1, 0.75]);
  });

  it("prefers the player engine position", () => {
    const reader = { queueItemId: "item", read: () => 11.5 };
    expect(readLivePosition({ clock: null, reader, fallbackSeconds: 0 }, 0)).toBe(11.5);
    expect(readLivePosition({ clock: null, reader: null, fallbackSeconds: 7 }, 0)).toBe(7);
  });

  it("fills words at the sung time with the host offset and no lookahead", () => {
    expect(fillTime(10, 0)).toBe(10);
    expect(fillTime(10, 1000)).toBe(9);
    expect(lineFills(LINE, fillTime(10.5, 0))).toEqual([0.5, 0]);
  });

  it("applies the lookahead and the host offset to line choice", () => {
    expect(lyricsTime(10, 0)).toBeCloseTo(10 + LOOKAHEAD_SECONDS);
    expect(lyricsTime(10, 1000)).toBeCloseTo(9 + LOOKAHEAD_SECONDS);
  });
});

describe("fillStyle", () => {
  it("paints whole words without a gradient", () => {
    expect(fillStyle(1, "rtl", "S", "U")).toEqual({ color: "S" });
    expect(fillStyle(0, "rtl", "S", "U")).toEqual({ color: "U" });
  });

  it("moves the colour edge from the right in right to left words", () => {
    expect(fillStyle(0.4, "rtl", "S", "U").backgroundImage).toBe("linear-gradient(to left, S 40.00%, U 40.00%)");
  });

  it("moves the colour edge from the left in left to right words", () => {
    expect(fillStyle(0.4, "ltr", "S", "U").backgroundImage).toBe("linear-gradient(to right, S 40.00%, U 40.00%)");
  });
});
