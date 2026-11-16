import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricsResult } from "./lyrics.js";
import type { TranscriptWord } from "../lyrics/tokens.js";

const { mockTranscribe, mockEnv } = vi.hoisted(() => ({
  mockTranscribe: vi.fn(),
  mockEnv: { TRANSCRIBE_BACKEND: "cuda" },
}));

vi.mock("../env.js", () => ({ env: mockEnv }));
vi.mock("./transcribe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transcribe.js")>()),
  transcribeVocals: mockTranscribe,
}));

import { addTimedLyrics, applyTranscript, planTimedLyrics } from "./timedLyrics.js";

const none: LyricsResult = { syncedLyrics: null, plainLyrics: null, source: "none", missReason: "not_found", matchedQuery: null };
const plain: LyricsResult = {
  syncedLyrics: null,
  plainLyrics: "you used to call me on my cell phone\nlate night when you need my love\ncall me on my cell phone",
  source: "lrclib_plain",
  missReason: null,
  matchedQuery: "q",
};
const synced: LyricsResult = { ...plain, syncedLyrics: "[00:01.00]x", source: "lrclib" };

function sung(text: string, start: number): TranscriptWord[] {
  return text.split(" ").map((w, i) => ({ text: ` ${w}`, start: start + i * 0.4, end: start + i * 0.4 + 0.3, probability: 0.9 }));
}

const heard = [
  ...sung("you used to call me on my cell phone", 10),
  ...sung("late night when you need my love", 16),
  ...sung("call me on my cell phone", 22),
];
const log = vi.fn();

describe("planTimedLyrics", () => {
  it("never touches synced lyrics, aligns plain text and transcribes otherwise", () => {
    expect(planTimedLyrics(synced)).toBe("skip");
    expect(planTimedLyrics(plain)).toBe("align");
    expect(planTimedLyrics(none)).toBe("transcribe");
  });
});

describe("applyTranscript", () => {
  it("stores generated lines as whisper lyrics", () => {
    const result = applyTranscript(none, heard, log);
    expect(result.source).toBe("whisper");
    expect(result.missReason).toBeNull();
    expect(result.syncedLyrics?.split("\n")[0]).toMatch(/^\[00:10\.00\]you used to call/);
  });

  it("aligns plain lyrics and keeps the plain text", () => {
    const result = applyTranscript(plain, heard, log);
    expect(result.source).toBe("aligned");
    expect(result.plainLyrics).toBe(plain.plainLyrics);
    expect(result.syncedLyrics).toBe("[00:10.00]you used to call me on my cell phone\n[00:16.00]late night when you need my love\n[00:22.00]call me on my cell phone");
  });

  it("keeps the manual source for pasted lyrics", () => {
    expect(applyTranscript({ ...plain, source: "manual" }, heard, log).source).toBe("manual");
  });

  it("keeps plain lyrics when alignment is rejected", () => {
    expect(applyTranscript(plain, sung("something else entirely sung here today", 3), log)).toBe(plain);
  });

  it("keeps no lyrics when the transcript is too thin", () => {
    expect(applyTranscript(none, sung("yeah", 3), log)).toBe(none);
  });

  it("aligns Tab4U lyrics like any other plain source", () => {
    expect(applyTranscript({ ...plain, source: "tab4u" }, heard, log).source).toBe("aligned");
  });

  it("drops rejected Tab4U lyrics and falls back to Whisper lines", () => {
    const scraped: LyricsResult = { ...plain, plainLyrics: "a different song\nwith other words\nthat nobody sang", source: "tab4u" };
    const result = applyTranscript(scraped, heard, log);
    expect(result).toMatchObject({ source: "whisper", plainLyrics: null, missReason: null });
    expect(result.syncedLyrics?.split("\n")[0]).toMatch(/^\[00:10\.00\]you used to call/);
  });

  it("shows nothing when rejected Tab4U lyrics meet a thin transcript", () => {
    const result = applyTranscript({ ...plain, source: "tab4u" }, sung("something else entirely sung here today", 3), log);
    expect(result).toMatchObject({ source: "none", syncedLyrics: null, plainLyrics: null, missReason: "not_found" });
  });

  it("keeps pasted lyrics when alignment is rejected", () => {
    const manual: LyricsResult = { ...plain, source: "manual" };
    expect(applyTranscript(manual, sung("something else entirely sung here today", 3), log)).toBe(manual);
  });
});

describe("addTimedLyrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.TRANSCRIBE_BACKEND = "cuda";
  });

  it("does nothing when transcription is off", async () => {
    mockEnv.TRANSCRIBE_BACKEND = "none";
    expect(await addTimedLyrics({ title: "t" }, none, "/v.mp3", log)).toBe(none);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it("does not transcribe songs that already have synced lyrics", async () => {
    expect(await addTimedLyrics({ title: "t" }, synced, "/v.mp3", log)).toBe(synced);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it("passes a Hebrew hint for Hebrew titles", async () => {
    mockTranscribe.mockResolvedValueOnce({ language: "he", device: "cuda", words: heard, wallMs: 1 });
    await addTimedLyrics({ title: "נופיה - פרח" }, none, "/v.mp3", log);
    expect(mockTranscribe).toHaveBeenCalledWith("/v.mp3", "he");
  });

  it("keeps existing lyrics when transcription fails", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("transcribe.py timed out after 180000ms"));
    expect(await addTimedLyrics({ title: "t" }, plain, "/v.mp3", log)).toBe(plain);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("timed out"));
  });

  it("skips songs without a vocals stem", async () => {
    expect(await addTimedLyrics({ title: "t" }, none, null, log)).toBe(none);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });
});
