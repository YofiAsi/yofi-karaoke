import { describe, expect, it } from "vitest";
import {
  clockPosition,
  hasReachedEnd,
  isRunning,
  nextFrameTime,
  pauseClock,
  pausedClock,
  seekClock,
  snapToFrame,
  startClock,
} from "./stemClock";

const RATE = 48_000;

describe("stemClock", () => {
  it("starts paused at the offset", () => {
    const clock = pausedClock(200, 12);
    expect(isRunning(clock)).toBe(false);
    expect(clockPosition(clock, 999)).toBe(12);
  });

  it("clamps a paused offset into the song", () => {
    expect(pausedClock(200, -3).offsetSeconds).toBe(0);
    expect(pausedClock(200, 250).offsetSeconds).toBe(200);
  });

  it("advances with the context clock while playing", () => {
    const clock = startClock(pausedClock(200, 10), 5);
    expect(clockPosition(clock, 5)).toBe(10);
    expect(clockPosition(clock, 7.5)).toBe(12.5);
  });

  it("holds the offset until a future start time arrives", () => {
    const clock = startClock(pausedClock(200, 10), 5);
    expect(clockPosition(clock, 4.9)).toBe(10);
  });

  it("ignores a second start while already running", () => {
    const clock = startClock(pausedClock(200, 10), 5);
    expect(startClock(clock, 9)).toBe(clock);
  });

  it("freezes the position on pause", () => {
    const paused = pauseClock(startClock(pausedClock(200, 10), 5), 8);
    expect(isRunning(paused)).toBe(false);
    expect(clockPosition(paused, 100)).toBe(13);
  });

  it("resumes from the frozen position", () => {
    const paused = pauseClock(startClock(pausedClock(200, 10), 5), 8);
    const resumed = startClock(paused, 20);
    expect(clockPosition(resumed, 21)).toBe(14);
  });

  it("seeks while paused without starting", () => {
    const seeked = seekClock(pausedClock(200, 10), 60, 3);
    expect(isRunning(seeked)).toBe(false);
    expect(clockPosition(seeked, 50)).toBe(60);
  });

  it("seeks while playing and keeps running from the restart time", () => {
    const playing = startClock(pausedClock(200, 10), 5);
    const seeked = seekClock(playing, 60, 9);
    expect(isRunning(seeked)).toBe(true);
    expect(clockPosition(seeked, 9)).toBe(60);
    expect(clockPosition(seeked, 11)).toBe(62);
  });

  it("clamps a seek into the song", () => {
    expect(clockPosition(seekClock(pausedClock(200), 500, 0), 0)).toBe(200);
    expect(clockPosition(seekClock(pausedClock(200), -1, 0), 0)).toBe(0);
  });

  it("stops at the end and reports reaching it", () => {
    const clock = startClock(pausedClock(200, 195), 0);
    expect(hasReachedEnd(clock, 4)).toBe(false);
    expect(clockPosition(clock, 10)).toBe(200);
    expect(hasReachedEnd(clock, 10)).toBe(true);
  });

  it("snaps times onto sample frames", () => {
    expect(snapToFrame(1.00001, RATE) * RATE).toBe(48_000);
    expect(nextFrameTime(1.00001, RATE) * RATE).toBe(48_001);
    expect(nextFrameTime(1, RATE)).toBe(1);
  });

  it("gives a late joiner the same frame aligned offset as the running stem", () => {
    const start = nextFrameTime(0.123456, RATE);
    const clock = startClock(pausedClock(200, snapToFrame(42.000017, RATE)), start);
    const join = nextFrameTime(3.987654, RATE);
    const offset = clockPosition(clock, join);
    expect(Math.abs(offset * RATE - Math.round(offset * RATE))).toBeLessThan(1e-6);
    expect(offset - clock.offsetSeconds).toBeCloseTo(join - start, 9);
  });
});
