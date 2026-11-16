import { describe, expect, it } from "vitest";
import { MAX_MANUAL_LYRICS_CHARS, checkManualLyrics, isAutomaticLyrics } from "./manualLyrics";

describe("checkManualLyrics", () => {
  it("trims and accepts normal text", () => {
    expect(checkManualLyrics("  שורה ראשונה\nשורה שנייה \n")).toEqual({ ok: true, text: "שורה ראשונה\nשורה שנייה" });
  });

  it("rejects empty and oversized text", () => {
    expect(checkManualLyrics(" \n ")).toEqual({ ok: false, reason: "empty" });
    expect(checkManualLyrics("x".repeat(MAX_MANUAL_LYRICS_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("isAutomaticLyrics", () => {
  it("flags only Whisper generated lyrics", () => {
    expect(isAutomaticLyrics("whisper")).toBe(true);
    for (const source of ["lrclib", "aligned", "manual", "none", null, undefined]) expect(isAutomaticLyrics(source)).toBe(false);
  });
});
