import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricsResult } from "../steps/lyrics.js";

const { mockQuery, mockNotify, mockFetchLyrics, mockAddTimed, mockEnabled, mockRomanize } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockNotify: vi.fn(),
  mockFetchLyrics: vi.fn(),
  mockAddTimed: vi.fn(),
  mockEnabled: vi.fn(() => false),
  mockRomanize: vi.fn(),
}));

vi.mock("../env.js", () => ({ env: { LYRICS_ROMAJI_ENABLED: true } }));
vi.mock("../steps/romanizer.js", () => ({ runRomanizer: mockRomanize }));
vi.mock("../db.js", () => ({ pool: { query: mockQuery }, notify: mockNotify }));
vi.mock("../steps/lyrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../steps/lyrics.js")>()),
  fetchLyrics: mockFetchLyrics,
}));

vi.mock("../steps/timedLyrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../steps/timedLyrics.js")>()),
  addTimedLyrics: mockAddTimed,
  transcriptionEnabled: mockEnabled,
}));
vi.mock("../storage/stemFile.js", () => ({
  withStemFile: (key: string, use: (file: string) => Promise<unknown>) => use(`/stems/${key}`),
}));

import { withSongLock } from "../songLock.js";
import { decideRefetch, refetchLyrics } from "./refetchLyrics.js";

const synced: LyricsResult = { syncedLyrics: "[00:01.00]a", plainLyrics: "a", source: "lrclib", missReason: null, matchedQuery: "q" };
const plainOnly: LyricsResult = { syncedLyrics: null, plainLyrics: "a", source: "lrclib_plain", missReason: null, matchedQuery: "q" };
const notFound: LyricsResult = { syncedLyrics: null, plainLyrics: null, source: "none", missReason: "not_found", matchedQuery: null };
const rateLimited: LyricsResult = { ...notFound, missReason: "rate_limited" };

const storedSynced = { lyricsLrc: "[00:01.00]old", lyricsPlain: "old" };
const storedPlain = { lyricsLrc: null, lyricsPlain: "old" };
const storedNone = { lyricsLrc: null, lyricsPlain: null };

describe("decideRefetch", () => {
  it.each([
    ["rate_limited", rateLimited],
    ["timeout", { ...notFound, missReason: "timeout" as const }],
    ["network_error", { ...notFound, missReason: "network_error" as const }],
    ["http_error", { ...notFound, missReason: "http_error" as const }],
  ])("retries on transient %s", (_reason, fresh) => {
    expect(decideRefetch(storedSynced, fresh)).toBe("retry");
    expect(decideRefetch(storedNone, fresh)).toBe("retry");
  });

  it("never downgrades synced lyrics", () => {
    expect(decideRefetch(storedSynced, plainOnly)).toBe("keep");
    expect(decideRefetch(storedSynced, notFound)).toBe("keep");
    expect(decideRefetch(storedPlain, notFound)).toBe("keep");
  });

  it("saves results at least as good as what is stored", () => {
    expect(decideRefetch(storedSynced, synced)).toBe("save");
    expect(decideRefetch(storedPlain, plainOnly)).toBe("save");
    expect(decideRefetch(storedPlain, synced)).toBe("save");
    expect(decideRefetch(storedNone, notFound)).toBe("save");
  });

  const whisper: LyricsResult = { ...notFound, syncedLyrics: "[00:01.00]heard", source: "whisper", missReason: null };
  const aligned: LyricsResult = { ...plainOnly, syncedLyrics: "[00:01.00]a", source: "aligned" };

  it("ranks LRCLIB synced over aligned over Whisper over plain", () => {
    const storedLrclib = { ...storedSynced, lyricsSource: "lrclib" };
    const storedWhisper = { lyricsLrc: "[00:01.00]heard", lyricsPlain: null, lyricsSource: "whisper" };
    expect(decideRefetch(storedLrclib, aligned)).toBe("keep");
    expect(decideRefetch(storedLrclib, whisper)).toBe("keep");
    expect(decideRefetch(storedWhisper, aligned)).toBe("save");
    expect(decideRefetch(storedWhisper, plainOnly)).toBe("keep");
    expect(decideRefetch(storedPlain, whisper)).toBe("save");
  });
});

describe("refetchLyrics task", () => {
  const helpers = { logger: { info: vi.fn(), warn: vi.fn() }, job: { id: "7" } } as unknown as Parameters<typeof refetchLyrics>[1];
  const row = { title: "A - B", artist: "A", track: null, trackArtist: null, durationSeconds: 200, ...storedSynced };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnabled.mockReturnValue(false);
    mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });
    mockRomanize.mockImplementation(async (lines: string[]) => ({ lines: lines.map((line) => FAKE_ROMAJI[line] ?? line), failed: 0 }));
  });

  it("waits while another job holds the song", async () => {
    let release: () => void = () => void 0;
    const held = withSongLock("s1", () => new Promise<void>((resolve) => (release = resolve)));
    mockFetchLyrics.mockResolvedValueOnce(synced);
    const refetch = refetchLyrics({ songId: "s1" }, helpers);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockQuery).not.toHaveBeenCalled();
    release();
    await Promise.all([held, refetch]);
    expect(mockQuery).toHaveBeenCalled();
  });

  it("returns without fetching when the song no longer exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(refetchLyrics({ songId: "gone" }, helpers)).resolves.toBeUndefined();
    expect(mockFetchLyrics).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("throws on a transient miss so graphile retries, without writing", async () => {
    mockFetchLyrics.mockResolvedValueOnce(rateLimited);
    await expect(refetchLyrics({ songId: "s1" }, helpers)).rejects.toThrow(/rate_limited/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps stored synced lyrics when the new result is plain only", async () => {
    mockFetchLyrics.mockResolvedValueOnce(plainOnly);
    await refetchLyrics({ songId: "s1" }, helpers);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("saves and notifies when the new result is good", async () => {
    mockFetchLyrics.mockResolvedValueOnce(synced);
    await refetchLyrics({ songId: "s1" }, helpers);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][1].slice(0, 5)).toEqual(["s1", synced.syncedLyrics, synced.plainLyrics, "lrclib", null]);
    expect(mockNotify).toHaveBeenCalledOnce();
  });

  it("transcribes the stored vocals stem after a LRCLIB miss", async () => {
    mockEnabled.mockReturnValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ ...row, ...storedNone, lyricsSource: "none", vocalsObjectKey: "vocals/s1.mp3" }] });
    mockFetchLyrics.mockResolvedValueOnce(notFound);
    mockAddTimed.mockResolvedValueOnce({ lyrics: whisperResult, words: null });
    await refetchLyrics({ songId: "s1" }, helpers);
    expect(mockAddTimed.mock.calls[0][2]).toBe("/stems/vocals/s1.mp3");
    expect(mockAddTimed.mock.calls[0][4]).toEqual({ tier: 1, order: 7 });
    expect(mockQuery.mock.calls[1][1].slice(0, 4)).toEqual(["s1", whisperResult.syncedLyrics, null, "whisper"]);
    expect(mockNotify).toHaveBeenCalledOnce();
  });

  it("aligns pasted lyrics without asking LRCLIB", async () => {
    mockEnabled.mockReturnValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ ...row, ...storedPlain, lyricsSource: "manual", vocalsObjectKey: "vocals/s1.mp3" }] });
    mockAddTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({
      lyrics: { ...lyrics, syncedLyrics: "[00:02.00]old" },
      words: [heardWord("old", 2.1, 2.6)],
    }));
    await refetchLyrics({ songId: "s1" }, helpers);
    expect(mockFetchLyrics).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[1][1].slice(0, 4)).toEqual(["s1", "[00:02.00]old", "old", "manual"]);
    expect(savedTimings(mockQuery.mock.calls[1][1][7])).toEqual([{ start: 2, end: 2.6, words: [{ text: "old", start: 2.1, end: 2.6 }] }]);
  });

  describe("Japanese lyrics", () => {
    const japaneseRow = { ...row, lyricsLrc: "[00:01.00]夢をみた", lyricsPlain: "夢をみた", lyricsSource: "lrclib" };

    function textUpdate() {
      return mockQuery.mock.calls.find(([sql]) => String(sql).includes('"lyricsPlain" = $3') && !String(sql).includes("lyricsSource"));
    }

    it("rewrites stored Japanese lyrics as romaji when the lookup finds nothing better", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [japaneseRow] });
      mockFetchLyrics.mockResolvedValueOnce(notFound);
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(textUpdate()?.[1]).toEqual(["s1", "[00:01.00]yume o mita", "yume o mita", "[00:01.00]夢をみた", "夢をみた", null]);
      expect(mockNotify).toHaveBeenCalledOnce();
    });

    it("rewrites stored Japanese lyrics before retrying a transient miss", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [japaneseRow] });
      mockFetchLyrics.mockResolvedValueOnce(rateLimited);
      await expect(refetchLyrics({ songId: "s1" }, helpers)).rejects.toThrow(/rate_limited/);
      expect(textUpdate()?.[1].slice(1, 3)).toEqual(["[00:01.00]yume o mita", "yume o mita"]);
    });

    it("saves a fresh Japanese result as romaji with its own source", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [japaneseRow] });
      mockFetchLyrics.mockResolvedValueOnce({ ...synced, syncedLyrics: "[00:02.00]空へとぶ", plainLyrics: "空へとぶ" });
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(mockQuery.mock.calls[1][1].slice(0, 5)).toEqual(["s1", "[00:02.00]sora e tobu", "sora e tobu", "lrclib", null]);
      expect(textUpdate()).toBeUndefined();
    });

    it("aligns pasted Japanese lyrics in their script and stores them as romaji", async () => {
      mockEnabled.mockReturnValue(true);
      mockQuery.mockResolvedValueOnce({ rows: [{ ...row, lyricsLrc: null, lyricsPlain: "夢をみた", lyricsSource: "manual", vocalsObjectKey: "vocals/s1.mp3" }] });
      mockAddTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({
        lyrics: { ...lyrics, syncedLyrics: "[00:05.00]夢をみた" },
        words: [heardWord("夢をみた", 5.1, 6)],
      }));
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(mockAddTimed.mock.calls[0][1].plainLyrics).toBe("夢をみた");
      expect(mockQuery.mock.calls[1][1].slice(0, 4)).toEqual(["s1", "[00:05.00]yume o mita", "yume o mita", "manual"]);
      expect(mockQuery.mock.calls[1][1][7]).toBeNull();
    });

    it("keeps good stored lyrics untouched when they are not Japanese", async () => {
      mockFetchLyrics.mockResolvedValueOnce(notFound);
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(mockRomanize).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("keeps the stored Japanese lyrics when romanization fails", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [japaneseRow] });
      mockFetchLyrics.mockResolvedValueOnce(notFound);
      mockRomanize.mockRejectedValueOnce(new Error("romanizer unavailable: cutlet ModuleNotFoundError; pykakasi ModuleNotFoundError"));
      await expect(refetchLyrics({ songId: "s1" }, helpers)).resolves.toBeUndefined();
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("word timings", () => {
    const vocalsRow = { ...row, lyricsSource: "lrclib", vocalsObjectKey: "vocals/s1.mp3" };

    function textUpdate() {
      return mockQuery.mock.calls.find(([sql]) => String(sql).includes('"lyricsPlain" = $3') && !String(sql).includes("lyricsSource"));
    }

    it("clears word timings in the same write that replaces the LRC without a transcript", async () => {
      mockFetchLyrics.mockResolvedValueOnce(synced);
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(String(mockQuery.mock.calls[1][0])).toContain('ELSE $8::jsonb END');
      expect(mockQuery.mock.calls[1][1].slice(7)).toEqual([null, false]);
    });

    it("replaces word timings together with a fresh LRC", async () => {
      mockEnabled.mockReturnValue(true);
      mockQuery.mockResolvedValueOnce({ rows: [vocalsRow] });
      mockFetchLyrics.mockResolvedValueOnce(synced);
      mockAddTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: [heardWord("a", 1.2, 1.7)] }));
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(mockQuery.mock.calls[1][1][1]).toBe(synced.syncedLyrics);
      expect(savedTimings(mockQuery.mock.calls[1][1][7])).toEqual([{ start: 1, end: 1.7, words: [{ text: "a", start: 1.2, end: 1.7 }] }]);
    });

    it("gives kept stored lyrics word timings when Find lyrics again finds nothing better", async () => {
      mockEnabled.mockReturnValue(true);
      mockQuery.mockResolvedValueOnce({ rows: [vocalsRow] });
      mockFetchLyrics.mockResolvedValueOnce(notFound);
      mockAddTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: [heardWord("old", 1.1, 1.5)] }));
      await refetchLyrics({ songId: "s1" }, helpers);
      const update = textUpdate()!;
      expect(update[1].slice(0, 5)).toEqual(["s1", "[00:01.00]old", "old", "[00:01.00]old", "old"]);
      expect(savedTimings(update[1][5])).toEqual([{ start: 1, end: 1.5, words: [{ text: "old", start: 1.1, end: 1.5 }] }]);
      expect(mockNotify).toHaveBeenCalledOnce();
    });

    it("keeps stored word timings when the fresh text is unchanged and no new words were produced", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [vocalsRow] });
      mockFetchLyrics.mockResolvedValueOnce({ ...synced, syncedLyrics: row.lyricsLrc, plainLyrics: row.lyricsPlain });
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(mockQuery.mock.calls[1][1].slice(7)).toEqual([null, true]);
    });

    it("survives a database error while refreshing kept lyrics", async () => {
      const japaneseRow = { ...row, lyricsLrc: "[00:01.00]夢をみた", lyricsPlain: "夢をみた", lyricsSource: "lrclib" };
      mockQuery.mockResolvedValueOnce({ rows: [japaneseRow] }).mockRejectedValueOnce(new Error("connection reset"));
      mockFetchLyrics.mockResolvedValueOnce(notFound);
      await expect(refetchLyrics({ songId: "s1" }, helpers)).resolves.toBeUndefined();
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("writes nothing for kept lyrics when the transcript times no line", async () => {
      mockEnabled.mockReturnValue(true);
      mockQuery.mockResolvedValueOnce({ rows: [vocalsRow] });
      mockFetchLyrics.mockResolvedValueOnce(notFound);
      mockAddTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: [heardWord("unrelated", 30, 31)] }));
      await refetchLyrics({ songId: "s1" }, helpers);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  it("drops the result when the lyrics changed meanwhile", async () => {
    mockFetchLyrics.mockResolvedValueOnce(synced);
    mockQuery.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rowCount: 0 });
    await refetchLyrics({ songId: "s1" }, helpers);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

const FAKE_ROMAJI: Record<string, string> = { "夢をみた": "yume o mita", "空へとぶ": "sora e tobu" };

const whisperResult: LyricsResult = {
  syncedLyrics: "[00:01.00]heard line",
  plainLyrics: null,
  source: "whisper",
  missReason: null,
  matchedQuery: null,
};

function heardWord(text: string, start: number, end: number) {
  return { text: ` ${text}`, start, end, probability: 0.9 };
}

function savedTimings(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
