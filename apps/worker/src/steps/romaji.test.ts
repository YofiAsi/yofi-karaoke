import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricsResult } from "./lyrics.js";

const m = vi.hoisted(() => ({
  env: { LYRICS_ROMAJI_ENABLED: true } as Record<string, unknown>,
  run: vi.fn(),
}));

vi.mock("../env.js", () => ({ env: m.env }));
vi.mock("./romanizer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./romanizer.js")>()),
  runRomanizer: m.run,
}));

import { isJapanese, kanaShare, MIN_KANA_SHARE, needsRomaji, romanizeLyrics, splitLrcLine } from "./romaji.js";
import { parseRomanizerOutput } from "./romanizer.js";

const FAKE_ROMAJI: Record<string, string> = { "夢をみた": "yume o mita", "空へとぶ": "sora e tobu", "ゆめ": "yume" };

function fakeRomanizer(lines: string[]) {
  return Promise.resolve({ lines: lines.map((line) => FAKE_ROMAJI[line] ?? line), failed: 0 });
}

function lyrics(syncedLyrics: string | null, plainLyrics: string | null): LyricsResult {
  return { syncedLyrics, plainLyrics, source: "lrclib", missReason: null, matchedQuery: "q" };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.env.LYRICS_ROMAJI_ENABLED = true;
  m.run.mockImplementation(fakeRomanizer);
});

describe("isJapanese", () => {
  it("needs hiragana or katakana", () => {
    expect(isJapanese("夢をみた")).toBe(true);
    expect(isJapanese("コーヒー")).toBe(true);
    expect(isJapanese("ｶﾀｶﾅ")).toBe(true);
  });

  it("leaves Chinese, Hebrew and Latin text alone", () => {
    expect(isJapanese("我们一起走吧")).toBe(false);
    expect(isJapanese("שיר על הים")).toBe(false);
    expect(isJapanese("yume o mita")).toBe(false);
    expect(isJapanese(null)).toBe(false);
  });

  it("needs a minimum share of kana among kana and Han characters", () => {
    const chinese = "今天天气很好我们一起走吧\n城市の夜晚灯火辉煌";
    const kanjiHeavyJapanese = "永遠の愛を誓う\n運命の糸\n夢幻の世界\n天空に響く鐘";
    expect(kanaShare(chinese)).toBeLessThan(MIN_KANA_SHARE);
    expect(isJapanese(chinese)).toBe(false);
    expect(kanaShare(kanjiHeavyJapanese)).toBeGreaterThanOrEqual(MIN_KANA_SHARE);
    expect(isJapanese(kanjiHeavyJapanese)).toBe(true);
  });
});

describe("splitLrcLine", () => {
  it("separates timestamps, including repeated ones and the space after them", () => {
    expect(splitLrcLine("[00:12.34]夢をみた")).toEqual({ prefix: "[00:12.34]", text: "夢をみた" });
    expect(splitLrcLine("[01:02.003][02:03.00] ゆめ")).toEqual({ prefix: "[01:02.003][02:03.00] ", text: "ゆめ" });
    expect(splitLrcLine("[ar:歌手]")).toEqual({ prefix: "[ar:歌手]", text: "" });
    expect(splitLrcLine("ゆめ")).toEqual({ prefix: "", text: "ゆめ" });
  });
});

describe("romanizeLyrics", () => {
  const log = vi.fn();

  it("converts synced and plain lyrics, keeping timestamps, order, empty lines and the source", async () => {
    const input = lyrics("[00:01.00]夢をみた\n[00:04.50] 空へとぶ\n[00:07.00]\n[00:09.00]ゆめ", "夢をみた\n\n空へとぶ");
    const result = await romanizeLyrics({ ...input, source: "aligned" }, log);
    expect(result.syncedLyrics).toBe("[00:01.00]yume o mita\n[00:04.50] sora e tobu\n[00:07.00]\n[00:09.00]yume");
    expect(result.plainLyrics).toBe("yume o mita\n\nsora e tobu");
    expect(result.source).toBe("aligned");
    expect(m.run).toHaveBeenCalledOnce();
    expect(m.run).toHaveBeenCalledWith(["夢をみた", "空へとぶ", "", "ゆめ", "夢をみた", "", "空へとぶ"]);
  });

  it("keeps missing parts missing", async () => {
    const result = await romanizeLyrics(lyrics(null, "ゆめ"), log);
    expect(result).toMatchObject({ syncedLyrics: null, plainLyrics: "yume" });
  });

  it.each([
    ["Chinese", "[00:01.00]我们一起走吧"],
    ["Chinese with one の", "[00:01.00]今天天气很好我们一起走吧\n[00:04.00]城市の夜晚灯火辉煌"],
    ["romaji under a Japanese title tag", "[ti:夢のうた]\n[ar:うたびと]\n[00:01.00]yume o mita"],
    ["Hebrew", "[00:01.00]שיר על הים"],
    ["English", "[00:01.00]Dancing in the moonlight"],
    ["romaji", "[00:01.00]yume o mita"],
  ])("leaves %s lyrics untouched without running Python", async (_name, synced) => {
    const input = lyrics(synced, null);
    expect(await romanizeLyrics(input, log)).toBe(input);
    expect(m.run).not.toHaveBeenCalled();
  });

  it("ignores LRC tag lines when deciding whether a song is Japanese", () => {
    expect(needsRomaji(lyrics("[ti:夢のうた]\n[00:01.00]Dancing in the moonlight", null))).toBe(false);
    expect(needsRomaji(lyrics("[ti:Song]\n[00:01.00]夢をみた", null))).toBe(true);
  });

  it("does nothing when LYRICS_ROMAJI_ENABLED is false", async () => {
    m.env.LYRICS_ROMAJI_ENABLED = false;
    const input = lyrics("[00:01.00]夢をみた", null);
    expect(await romanizeLyrics(input, log)).toBe(input);
    expect(m.run).not.toHaveBeenCalled();
  });

  it("keeps the Japanese lyrics and logs once when the conversion fails", async () => {
    m.run.mockRejectedValueOnce(new Error("pykakasi unavailable: ModuleNotFoundError"));
    const input = lyrics("[00:01.00]夢をみた", "夢をみた");
    expect(await romanizeLyrics(input, log)).toBe(input);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/romaji conversion failed.*pykakasi unavailable/);
  });

  it("logs how many lines Python kept in Japanese script", async () => {
    m.run.mockResolvedValueOnce({ lines: ["夢をみた"], failed: 1 });
    await romanizeLyrics(lyrics(null, "夢をみた"), log);
    expect(log.mock.calls[0][0]).toMatch(/1 kept in Japanese script/);
  });
});

describe("parseRomanizerOutput", () => {
  it("reads the last JSON line", () => {
    expect(parseRomanizerOutput('noise\n{"lines":["yume"],"failed":0,"unavailable":null}\n', 1)).toEqual({ lines: ["yume"], failed: 0 });
  });

  it("rejects a missing library, a wrong line count and non JSON output", () => {
    expect(() => parseRomanizerOutput('{"lines":["ゆめ"],"failed":0,"unavailable":"ModuleNotFoundError"}', 1)).toThrow(/pykakasi unavailable/);
    expect(() => parseRomanizerOutput('{"lines":["a"],"failed":0,"unavailable":null}', 2)).toThrow(/wrong line list/);
    expect(() => parseRomanizerOutput("Traceback", 1)).toThrow(/no JSON/);
  });
});
