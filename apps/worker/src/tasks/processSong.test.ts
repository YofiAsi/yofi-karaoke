import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricsResult } from "../steps/lyrics.js";
import type { TimedLyrics } from "../steps/timedLyrics.js";
import type { TranscriptWord } from "../lyrics/tokens.js";

const m = vi.hoisted(() => ({
  query: vi.fn(),
  notify: vi.fn(),
  download: vi.fn(),
  separate: vi.fn(),
  prewarm: vi.fn(),
  fetchLyrics: vi.fn(),
  addTimed: vi.fn(),
  transcriptionOn: vi.fn(() => true),
  upload: vi.fn(),
  ready: vi.fn(),
  failed: vi.fn(),
  romanize: vi.fn(),
  events: [] as string[],
}));

vi.mock("../env.js", () => ({ env: { WORKER_TMP_DIR: "/tmp/karaoke-test", LYRICS_ROMAJI_ENABLED: true } }));
vi.mock("../db.js", () => ({ pool: { query: m.query }, notify: m.notify }));
vi.mock("../steps/download.js", () => ({ downloadYouTubeAudio: m.download }));
vi.mock("../steps/separate.js", () => ({ separateVocals: m.separate, prewarmSeparation: m.prewarm }));
vi.mock("../steps/lyrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../steps/lyrics.js")>()),
  fetchLyrics: m.fetchLyrics,
}));
vi.mock("../steps/timedLyrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../steps/timedLyrics.js")>()),
  addTimedLyrics: m.addTimed,
  transcriptionEnabled: m.transcriptionOn,
}));
vi.mock("../storage/index.js", () => ({ uploadStem: m.upload }));
vi.mock("../steps/romanizer.js", () => ({ runRomanizer: m.romanize }));
vi.mock("../queueState.js", () => ({ markSongReady: m.ready, markSongFailed: m.failed }));

import { processingSongIds, processSong } from "./processSong.js";

const SONG = { id: "s1", youtubeVideoId: "yt1", title: "נופיה - פרח", artist: "Nofia", track: null, trackArtist: null, durationSeconds: 164 };
const MISS: LyricsResult = { syncedLyrics: null, plainLyrics: null, source: "none", missReason: "not_found", matchedQuery: null };
const WHISPER: LyricsResult = { ...MISS, syncedLyrics: "[00:01.00]x", source: "whisper", missReason: null };
const SYNCED: LyricsResult = { ...MISS, syncedLyrics: "[00:01.00]paper boats\n[00:05.00]river", source: "lrclib", missReason: null };
const HEARD: TranscriptWord[] = [
  { text: " paper", start: 1.1, end: 1.5, probability: 0.9 },
  { text: " boats", start: 1.6, end: 2.1, probability: 0.9 },
  { text: " river", start: 5.2, end: 5.8, probability: 0.9 },
];
const STEMS = { instrumentalPath: "/w/i.mp3", vocalsPath: "/w/v.mp3", queuedMs: 0, wallMs: 9, loadMs: 0, inferenceMs: 5, encodeMs: 3 };

function deferred<T>() {
  let resolve: (value: T) => void = () => void 0;
  let reject: (err: Error) => void = () => void 0;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function helpers(attempts = 1) {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    job: { id: "42", attempts, max_attempts: 3 },
  } as unknown as Parameters<typeof processSong>[1];
}

function progress(): string[] {
  return m.notify.mock.calls
    .filter(([channel]) => channel === "song_progress")
    .map(([, payload]) => `${payload.step} ${payload.progressPct}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.events.length = 0;
  m.query.mockImplementation(async (sql: string) => (sql.includes(`FROM "Song" WHERE id`) ? { rows: [SONG] } : { rows: [], rowCount: 1 }));
  m.notify.mockResolvedValue(undefined);
  m.download.mockImplementation(async () => {
    m.events.push("download done");
    return { filePath: "/w/source.wav" };
  });
  m.separate.mockImplementation(async () => {
    m.events.push("separate done");
    return STEMS;
  });
  m.fetchLyrics.mockImplementation(async () => {
    m.events.push("lookup done");
    return MISS;
  });
  m.addTimed.mockImplementation(async () => {
    m.events.push("timed done");
    return { lyrics: WHISPER, words: null };
  });
  m.upload.mockImplementation(async (kind: string) => `${kind}/s1.mp3`);
  m.ready.mockImplementation(async () => void m.events.push("ready"));
  m.romanize.mockImplementation(async (lines: string[]) => {
    m.events.push("romaji done");
    return { lines: lines.map((line) => (line === "夢をみた" ? "yume o mita" : line)), failed: 0 };
  });
});

function saveCall(): unknown[] {
  const call = m.query.mock.calls.find(([sql]) => String(sql).includes('"lyricsMissReason" = $5'));
  return call ? call[1] : [];
}

function savedLyrics(): unknown[] {
  return saveCall().slice(1, 4);
}

function savedWordTimings(): unknown {
  const value = saveCall()[5];
  return typeof value === "string" ? JSON.parse(value) : value;
}

const JAPANESE_PLAIN: LyricsResult = { ...MISS, plainLyrics: "夢をみた", source: "lrclib_plain", missReason: null };
const JAPANESE_ALIGNED: LyricsResult = { ...JAPANESE_PLAIN, syncedLyrics: "[00:03.20]夢をみた", source: "aligned" };

describe("processSong", () => {
  it("looks lyrics up while downloading and marks the song ready only after timed lyrics finish", async () => {
    const download = deferred<{ filePath: string }>();
    m.download.mockReturnValueOnce(download.promise);
    const job = processSong({ songId: "s1" }, helpers());

    await vi.waitFor(() => expect(m.fetchLyrics).toHaveBeenCalledOnce());
    expect(m.events).toEqual(["lookup done"]);
    expect(processingSongIds()).toEqual(["s1"]);
    download.resolve({ filePath: "/w/source.wav" });
    await job;

    expect(m.events).toEqual(["lookup done", "separate done", "timed done", "ready"]);
    expect(m.prewarm).toHaveBeenCalledWith({ tier: 0, order: 42 });
    expect(m.separate).toHaveBeenCalledWith(expect.stringContaining("s1"), "/w/source.wav", { tier: 0, order: 42 });
    expect(m.addTimed).toHaveBeenCalledWith(SONG, MISS, "/w/v.mp3", expect.any(Function), { tier: 0, order: 42 });
    expect(progress()).toEqual(["downloading 5", "separating 35", "fetching_lyrics 80", "fetching_lyrics 90", "done 100"]);
    expect(processingSongIds()).toEqual([]);
  });

  it("waits for a slow lookup after separation before going further", async () => {
    const lookup = deferred<LyricsResult>();
    m.fetchLyrics.mockReturnValueOnce(lookup.promise);
    const job = processSong({ songId: "s1" }, helpers());

    await vi.waitFor(() => expect(m.events).toEqual(["download done", "separate done"]));
    expect(m.addTimed).not.toHaveBeenCalled();
    expect(m.ready).not.toHaveBeenCalled();
    lookup.resolve(MISS);
    await job;
    expect(m.events.slice(-2)).toEqual(["timed done", "ready"]);
  });

  it("uploads stems while timed lyrics run", async () => {
    const timed = deferred<TimedLyrics>();
    m.addTimed.mockReturnValueOnce(timed.promise);
    const job = processSong({ songId: "s1" }, helpers());

    await vi.waitFor(() => expect(m.upload).toHaveBeenCalledTimes(2));
    expect(m.ready).not.toHaveBeenCalled();
    timed.resolve({ lyrics: WHISPER, words: null });
    await job;
    expect(m.ready).toHaveBeenCalledOnce();
  });

  it("transcribes songs with LRCLIB synced lyrics too and saves word timings in the same write", async () => {
    m.fetchLyrics.mockResolvedValueOnce(SYNCED);
    m.addTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: HEARD }));
    await processSong({ songId: "s1" }, helpers());
    expect(m.addTimed.mock.calls[0][1]).toEqual(SYNCED);
    expect(progress()).toEqual(["downloading 5", "separating 35", "fetching_lyrics 80", "fetching_lyrics 90", "done 100"]);
    expect(savedLyrics()).toEqual([SYNCED.syncedLyrics, null, "lrclib"]);
    expect(savedWordTimings()).toEqual([
      { start: 1, end: 2.1, words: [{ text: "paper", start: 1.1, end: 1.5 }, { text: "boats", start: 1.6, end: 2.1 }] },
      { start: 5, end: 5.8, words: [{ text: "river", start: 5.2, end: 5.8 }] },
    ]);
  });

  it("skips the transcription progress step without a vocals stem", async () => {
    m.separate.mockResolvedValueOnce({ ...STEMS, vocalsPath: null });
    await processSong({ songId: "s1" }, helpers());
    expect(progress()).toEqual(["downloading 5", "separating 35", "fetching_lyrics 80", "done 100"]);
  });

  it("saves no word timings without a transcript", async () => {
    m.fetchLyrics.mockResolvedValueOnce(SYNCED);
    m.addTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: null }));
    await processSong({ songId: "s1" }, helpers());
    expect(savedLyrics()).toEqual([SYNCED.syncedLyrics, null, "lrclib"]);
    expect(savedWordTimings()).toBeNull();
  });

  it("keeps the lyrics and marks the song ready when word timing fails", async () => {
    m.fetchLyrics.mockResolvedValueOnce(SYNCED);
    const broken = HEARD.map((word) => ({ ...word, start: Number.NaN }));
    m.addTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: broken }));
    await processSong({ songId: "s1" }, helpers());
    expect(savedLyrics()).toEqual([SYNCED.syncedLyrics, null, "lrclib"]);
    expect(savedWordTimings()).toBeNull();
    expect(m.ready).toHaveBeenCalledOnce();
    expect(m.failed).not.toHaveBeenCalled();
  });

  it("fails the job at the join when the lookup itself throws, like before", async () => {
    m.fetchLyrics.mockRejectedValueOnce(new Error("db connection lost"));
    await expect(processSong({ songId: "s1" }, helpers())).rejects.toThrow("db connection lost");
    expect(m.events).toEqual(["download done", "separate done"]);
    expect(m.ready).not.toHaveBeenCalled();
    expect(progress().at(-1)).toBe("pending 0");
  });

  it("reports the download error even when the lookup later fails too", async () => {
    const lookup = deferred<LyricsResult>();
    m.fetchLyrics.mockReturnValueOnce(lookup.promise);
    m.download.mockRejectedValueOnce(new Error("yt-dlp exited with code 1"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await expect(processSong({ songId: "s1" }, helpers(3))).rejects.toThrow("yt-dlp exited with code 1");
      lookup.reject(new Error("late failure"));
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(m.separate).not.toHaveBeenCalled();
    expect(m.failed).toHaveBeenCalledWith("s1", "yt-dlp exited with code 1");
  });

  it("aligns Japanese lyrics in their script, then saves them as romaji with the source kept", async () => {
    m.fetchLyrics.mockResolvedValueOnce(JAPANESE_PLAIN);
    m.addTimed.mockImplementationOnce(async () => {
      m.events.push("timed done");
      return { lyrics: JAPANESE_ALIGNED, words: [{ text: "夢をみた", start: 3.3, end: 4, probability: 0.9 }] };
    });
    await processSong({ songId: "s1" }, helpers());
    expect(savedWordTimings()).toBeNull();
    expect(m.addTimed.mock.calls[0][1]).toEqual(JAPANESE_PLAIN);
    expect(m.romanize).toHaveBeenCalledWith(["夢をみた", "夢をみた"]);
    expect(savedLyrics()).toEqual(["[00:03.20]yume o mita", "yume o mita", "aligned"]);
    expect(m.events.slice(-3)).toEqual(["timed done", "romaji done", "ready"]);
  });

  it("does not run the romanizer for songs without kana", async () => {
    await processSong({ songId: "s1" }, helpers());
    expect(m.romanize).not.toHaveBeenCalled();
    expect(savedLyrics()).toEqual(["[00:01.00]x", null, "whisper"]);
  });

  it("saves the Japanese lyrics and still marks the song ready when romanization fails", async () => {
    m.fetchLyrics.mockResolvedValueOnce({ ...JAPANESE_ALIGNED, source: "lrclib" });
    m.addTimed.mockImplementationOnce(async (_song, lyrics: LyricsResult) => ({ lyrics, words: null }));
    m.romanize.mockRejectedValueOnce(new Error("romanize.py exited with code 1"));
    await processSong({ songId: "s1" }, helpers());
    expect(savedLyrics()).toEqual(["[00:03.20]夢をみた", "夢をみた", "lrclib"]);
    expect(m.ready).toHaveBeenCalledOnce();
    expect(m.failed).not.toHaveBeenCalled();
  });

  it("does not run two jobs for the same song at once", async () => {
    const download = deferred<{ filePath: string }>();
    m.download.mockReturnValueOnce(download.promise);
    const first = processSong({ songId: "s1" }, helpers());
    const second = processSong({ songId: "s1" }, helpers());
    await vi.waitFor(() => expect(m.download).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 10));
    expect(m.download).toHaveBeenCalledOnce();
    download.resolve({ filePath: "/w/source.wav" });
    await Promise.all([first, second]);
    expect(m.download).toHaveBeenCalledTimes(2);
    expect(m.ready).toHaveBeenCalledTimes(2);
  });
});
