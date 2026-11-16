import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    LRCLIB_BASE_URL: "https://lrclib.test",
    LRCLIB_TIMEOUT_MS: 1_000,
    LRCLIB_MIN_INTERVAL_MS: 0,
    LRCLIB_MAX_RETRIES: 2,
    LYRICS_OVH_TIMEOUT_MS: 1_000,
  },
}));

import { fetchLyrics, pickBestEntry } from "./lyrics.js";

const SYNCED = "[00:01.00]line";
const PLAIN = "line";

type Route = (url: URL) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(route: Route) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      calls.push(input);
      return route(input);
    }),
  );
  return calls;
}

const silent = () => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pickBestEntry", () => {
  it("rejects entries more than 15 seconds off and prefers synced", () => {
    const best = pickBestEntry(
      [
        { duration: 200, plainLyrics: PLAIN },
        { duration: 230, syncedLyrics: SYNCED, plainLyrics: PLAIN },
        { duration: 212, syncedLyrics: SYNCED },
        { duration: 205, syncedLyrics: SYNCED },
      ],
      200,
    );
    expect(best?.duration).toBe(205);
  });

  it("skips instrumental entries", () => {
    expect(pickBestEntry([{ duration: 200, instrumental: true, plainLyrics: PLAIN }], 200)).toBeNull();
  });
});

describe("fetchLyrics", () => {
  const song = { title: "Artist - Song (Official Video)", artist: "Artist VEVO", durationSeconds: 240 };

  it("returns synced and plain from the exact match endpoint", async () => {
    const calls = stubFetch((url) =>
      url.pathname === "/api/get" ? json({ duration: 239, syncedLyrics: SYNCED, plainLyrics: PLAIN }) : json([]),
    );
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "lrclib", syncedLyrics: SYNCED, plainLyrics: PLAIN, missReason: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get("track_name")).toBe("Song");
    expect(calls[0].searchParams.get("artist_name")).toBe("Artist");
  });

  it("falls back to search with duration scoring", async () => {
    stubFetch((url) =>
      url.pathname === "/api/get"
        ? json({ code: 404 }, 404)
        : json([
            { duration: 300, syncedLyrics: SYNCED },
            { duration: 228, syncedLyrics: SYNCED, plainLyrics: PLAIN },
          ]),
    );
    const result = await fetchLyrics(song, silent);
    expect(result.source).toBe("lrclib");
    expect(result.matchedQuery).toContain("search");
  });

  it("keeps a plain only result when nothing synced is found", async () => {
    stubFetch((url) =>
      url.pathname === "/api/get" ? json({}, 404) : json([{ duration: 241, plainLyrics: PLAIN }]),
    );
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "lrclib_plain", syncedLyrics: null, plainLyrics: PLAIN });
  });

  it("retries 429 and reports rate limiting when it persists", async () => {
    const calls = stubFetch((url) =>
      url.hostname === "lrclib.test"
        ? new Response("", { status: 429, headers: { "retry-after": "0.001" } })
        : json({}, 404),
    );
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "none", missReason: "rate_limited" });
    const lrclibCalls = calls.filter((c) => c.hostname === "lrclib.test");
    expect(lrclibCalls.length % 3).toBe(0);
    expect(lrclibCalls.length).toBeGreaterThanOrEqual(9);
  });

  it("uses lyrics.ovh last and reports not_found on a full miss", async () => {
    stubFetch(() => json({}, 404));
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "none", missReason: "not_found" });
  });

  it("reports network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await fetchLyrics(song, silent);
    expect(result.missReason).toBe("network_error");
  });

  it("returns ovh plain lyrics when LRCLIB misses", async () => {
    stubFetch((url) => (url.hostname === "api.lyrics.ovh" ? json({ lyrics: PLAIN }) : json({}, 404)));
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "ovh", plainLyrics: PLAIN, missReason: null });
  });
});
