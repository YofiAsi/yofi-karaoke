import { describe, expect, it } from "vitest";
import { rememberReport, shouldSeekPlayer } from "./seekEcho";

describe("rememberReport", () => {
  it("keeps only the latest reports", () => {
    const reports = [1, 2, 3, 4, 5, 6].reduce<number[]>(rememberReport, []);
    expect(reports).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("shouldSeekPlayer", () => {
  it("seeks to a host seek far from the audio clock", () => {
    expect(shouldSeekPlayer(30, 90, [28.9, 29.9])).toBe(true);
  });

  it("ignores small differences", () => {
    expect(shouldSeekPlayer(30, 29.2, [])).toBe(false);
  });

  it("ignores a stale position that only echoes an earlier report", () => {
    expect(shouldSeekPlayer(32, 29.9, [28.9, 29.9])).toBe(false);
  });

  it("seeks on load when there are no reports yet", () => {
    expect(shouldSeekPlayer(0, 75, [])).toBe(true);
  });
});
