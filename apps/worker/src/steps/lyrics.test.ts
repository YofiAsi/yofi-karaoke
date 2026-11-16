import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEnv, mockTab4u } = vi.hoisted(() => ({
  mockEnv: {
    LRCLIB_BASE_URL: "https://lrclib.test",
    LRCLIB_TIMEOUT_MS: 1_000,
    LRCLIB_MIN_INTERVAL_MS: 0,
    LRCLIB_MAX_RETRIES: 2,
    LYRICS_OVH_TIMEOUT_MS: 1_000,
    LYRICS_TAB4U_ENABLED: false,
  },
  mockTab4u: vi.fn(),
}));

vi.mock("../env.js", () => ({ env: mockEnv }));
vi.mock("./tab4u.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tab4u.js")>()),
  lookupTab4u: mockTab4u,
}));

import { artistMatches, fetchLyrics, pickBestEntry, retryDelayMs } from "./lyrics.js";

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
  mockTab4u.mockReset();
  mockEnv.LYRICS_TAB4U_ENABLED = false;
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

describe("retryDelayMs", () => {
  it("clamps a large Retry-After header to 10 seconds", () => {
    expect(retryDelayMs(new Response("", { status: 429, headers: { "retry-after": "600" } }), 0)).toBe(10_000);
  });

  it("backs off exponentially without a header", () => {
    expect(retryDelayMs(new Response("", { status: 429 }), 0)).toBe(2_000);
    expect(retryDelayMs(new Response("", { status: 429 }), 1)).toBe(4_000);
  });
});

describe("artistMatches", () => {
  it.each([
    ["Omer Adam", ["Omer Adam - עומר אדם"], true],
    ["עומר אדם", ["עומר אדם - שני משוגעים"], true],
    ["Mark Ronson feat. Bruno Mars", ["Mark Ronson"], true],
    ["Guy & Yahel", ["Hanan Ben Ari - חנן בן ארי", "חנן בן ארי"], false],
    ["Itay Levy", ["איתי לוי", "Itay Levi"], true],
    ["Eyal Golan", ["Eden Golan"], false],
    ["Adam", ["Adal"], false],
    [null, ["anything"], false],
  ])("%s against %j is %s", (artist, known, expected) => {
    expect(artistMatches(artist, known)).toBe(expected);
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

  it("retries 429, then stops querying LRCLIB for the rest of the run", async () => {
    const calls = stubFetch((url) =>
      url.hostname === "lrclib.test"
        ? new Response("", { status: 429, headers: { "retry-after": "0.001" } })
        : json({}, 404),
    );
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "none", missReason: "rate_limited" });
    expect(calls.filter((c) => c.hostname === "lrclib.test")).toHaveLength(3);
    expect(calls.filter((c) => c.hostname === "api.lyrics.ovh")).toHaveLength(1);
  });

  it("opens the breaker after the first LRCLIB timeout", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        calls.push(url);
        if (url.hostname === "lrclib.test") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
        return json({}, 404);
      }),
    );
    const result = await fetchLyrics(song, silent);
    expect(result.missReason).toBe("timeout");
    expect(calls.filter((c) => c.hostname === "lrclib.test")).toHaveLength(1);
  });

  it("makes no requests once the overall deadline has passed", async () => {
    const calls = stubFetch(() => json({}, 404));
    const result = await fetchLyrics(song, silent, 0);
    expect(result).toMatchObject({ source: "none", missReason: "timeout" });
    expect(calls).toHaveLength(0);
  });

  it("survives null and non array LRCLIB bodies", async () => {
    stubFetch((url) => {
      if (url.pathname === "/api/get") return json(null);
      if (url.searchParams.has("q")) return json([null, 7, { duration: 240, plainLyrics: PLAIN }]);
      return json({ error: "unexpected" });
    });
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "lrclib_plain", plainLyrics: PLAIN });
  });

  it("turns an unexpected exception into an http_error miss", async () => {
    const logs: string[] = [];
    const broken = { title: undefined as unknown as string, artist: "x", durationSeconds: 100 };
    const result = await fetchLyrics(broken, (m) => logs.push(m));
    expect(result).toMatchObject({ source: "none", missReason: "http_error" });
    expect(logs.some((l) => l.includes("failed unexpectedly"))).toBe(true);
  });

  it("does not trust artist names that only appear in the title", async () => {
    stubFetch((url) =>
      url.pathname === "/api/search" && url.searchParams.has("track_name") && !url.searchParams.has("artist_name")
        ? json([{ artistName: "Tudo", duration: 200, syncedLyrics: SYNCED }])
        : json({}, 404),
    );
    const result = await fetchLyrics({ title: "Somebody - Tudo Bom Remix", artist: "Other Channel", durationSeconds: 200 }, silent);
    expect(result.source).toBe("none");
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

  it("searches by track only and accepts only matching artists", async () => {
    const hebrewSong = {
      title: "סטטיק ובן אל תבורי - טודו בום (Prod. by Jordi)",
      artist: "Static & Ben El",
      durationSeconds: 196,
    };
    stubFetch((url) => {
      const trackOnly = url.pathname === "/api/search" && !url.searchParams.has("artist_name") && !url.searchParams.has("q");
      if (!trackOnly) return url.pathname === "/api/get" ? json({}, 404) : json([]);
      return json([
        { artistName: "Someone Else", duration: 195, syncedLyrics: SYNCED },
        { artistName: "Static & Ben El", duration: 189, syncedLyrics: SYNCED, plainLyrics: PLAIN },
      ]);
    });
    const result = await fetchLyrics(hebrewSong, silent);
    expect(result).toMatchObject({ source: "lrclib", syncedLyrics: SYNCED });
    expect(result.matchedQuery).toContain('track="טודו בום"');
  });

  it("rejects a same named track by another artist", async () => {
    stubFetch((url) =>
      url.pathname === "/api/search" && url.searchParams.has("track_name") && !url.searchParams.has("artist_name")
        ? json([{ artistName: "Guy & Yahel", duration: 210, syncedLyrics: SYNCED }])
        : json({}, 404),
    );
    const result = await fetchLyrics(
      { title: "חנן בן ארי - תאמין (קליפ רשמי)", artist: "Hanan Ben Ari - חנן בן ארי", durationSeconds: 215 },
      silent,
    );
    expect(result.source).toBe("none");
  });

  it("returns ovh plain lyrics when LRCLIB misses", async () => {
    stubFetch((url) => (url.hostname === "api.lyrics.ovh" ? json({ lyrics: PLAIN }) : json({}, 404)));
    const result = await fetchLyrics(song, silent);
    expect(result).toMatchObject({ source: "ovh", plainLyrics: PLAIN, missReason: null });
  });
});

describe("fetchLyrics Tab4U stage", () => {
  const hebrewSong = { title: "נופיה - פרח", artist: "Nofia", durationSeconds: 164 };
  const TAB4U_TEXT = "שורת בדיקה\nשורה נוספת";
  const tab4uHit = { kind: "hit", lyrics: TAB4U_TEXT, query: 'tab4u search q="נופיה פרח" -> tab4u song "נופיה ידידיה" / "פרח"' };

  function lrclibAnd(lrclib: (url: URL) => Response) {
    return stubFetch((url) => (url.hostname === "api.lyrics.ovh" ? json({ lyrics: PLAIN }) : lrclib(url)));
  }

  it("runs after an LRCLIB miss for Hebrew songs and before lyrics.ovh", async () => {
    mockEnv.LYRICS_TAB4U_ENABLED = true;
    mockTab4u.mockResolvedValue(tab4uHit);
    const calls = lrclibAnd(() => json({}, 404));
    const result = await fetchLyrics(hebrewSong, silent);
    expect(result).toMatchObject({ source: "tab4u", plainLyrics: TAB4U_TEXT, syncedLyrics: null, missReason: null });
    expect(result.matchedQuery).toContain("tab4u");
    expect(mockTab4u).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.hostname === "api.lyrics.ovh")).toBe(false);
  });

  it("prefers LRCLIB plain lyrics and never asks Tab4U then", async () => {
    mockEnv.LYRICS_TAB4U_ENABLED = true;
    lrclibAnd((url) => (url.pathname === "/api/get" ? json({}, 404) : json([{ duration: 164, plainLyrics: PLAIN }])));
    const result = await fetchLyrics(hebrewSong, silent);
    expect(result.source).toBe("lrclib_plain");
    expect(mockTab4u).not.toHaveBeenCalled();
  });

  it("is skipped for songs without Hebrew letters", async () => {
    mockEnv.LYRICS_TAB4U_ENABLED = true;
    lrclibAnd(() => json({}, 404));
    const result = await fetchLyrics({ title: "Artist - Song", artist: "Artist", durationSeconds: 200 }, silent);
    expect(result.source).toBe("ovh");
    expect(mockTab4u).not.toHaveBeenCalled();
  });

  it("is skipped when the env switch is off", async () => {
    lrclibAnd(() => json({}, 404));
    expect((await fetchLyrics(hebrewSong, silent)).source).toBe("ovh");
    expect(mockTab4u).not.toHaveBeenCalled();
  });

  it("falls through to lyrics.ovh on a Tab4U miss and keeps its failure as the miss reason", async () => {
    mockEnv.LYRICS_TAB4U_ENABLED = true;
    mockTab4u.mockResolvedValue({ kind: "miss", failure: "rate_limited" });
    lrclibAnd(() => json({}, 404));
    expect((await fetchLyrics(hebrewSong, silent)).source).toBe("ovh");
    stubFetch(() => json({}, 404));
    expect(await fetchLyrics(hebrewSong, silent)).toMatchObject({ source: "none", missReason: "rate_limited" });
  });

  it("passes the remaining lookup deadline to Tab4U", async () => {
    mockEnv.LYRICS_TAB4U_ENABLED = true;
    mockTab4u.mockResolvedValue({ kind: "miss", failure: null });
    stubFetch(() => json({}, 404));
    const before = Date.now();
    await fetchLyrics(hebrewSong, silent, 30_000);
    const deadlineAt = mockTab4u.mock.calls[0][1] as number;
    expect(deadlineAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(deadlineAt).toBeLessThanOrEqual(Date.now() + 30_000);
  });
});
