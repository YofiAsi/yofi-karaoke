import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricsResult } from "../steps/lyrics.js";

const { mockQuery, mockNotify, mockFetchLyrics } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockNotify: vi.fn(),
  mockFetchLyrics: vi.fn(),
}));

vi.mock("../env.js", () => ({ env: {} }));
vi.mock("../db.js", () => ({ pool: { query: mockQuery }, notify: mockNotify }));
vi.mock("../steps/lyrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../steps/lyrics.js")>()),
  fetchLyrics: mockFetchLyrics,
}));

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
});

describe("refetchLyrics task", () => {
  const helpers = { logger: { info: vi.fn() } } as unknown as Parameters<typeof refetchLyrics>[1];
  const row = { title: "A - B", artist: "A", track: null, trackArtist: null, durationSeconds: 200, ...storedSynced };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [row] });
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
    expect(mockQuery.mock.calls[1][1]).toEqual(["s1", synced.syncedLyrics, synced.plainLyrics, "lrclib", null]);
    expect(mockNotify).toHaveBeenCalledOnce();
  });
});
