import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricsCandidate } from "./lyricsQuery.js";

const { mockEnv } = vi.hoisted(() => ({ mockEnv: { TAB4U_TIMEOUT_MS: 1_000, TAB4U_MIN_INTERVAL_MS: 0 } }));
vi.mock("../env.js", () => ({ env: mockEnv }));

import {
  artistMatch,
  coversWholeTitle,
  decodeEntities,
  isChallengePage,
  isSiteHost,
  lookupTab4u,
  parseSearchResults,
  parseSongLyrics,
  pickTab4uResult,
  resetTab4uState,
  searchQueries,
  titlesMatch,
} from "./tab4u.js";

const SEARCH_HTML = readFileSync(new URL("./fixtures/tab4u-search.html", import.meta.url), "utf8");
const SONG_HTML = readFileSync(new URL("./fixtures/tab4u-song.html", import.meta.url), "utf8");
const EXPECTED_LYRICS = [
  "שורת בדיקה ראשונה",
  'מילה שנייה & ג\'וק "דמה"',
  "שלישית ארו כה כאן",
  "",
  "פזמון מומצא לבדיקה",
  "עוד שורה בלי משמעות",
].join("\n");

const nofia: LyricsCandidate[] = [
  { track: "פרח", artist: "נופיה", kind: "split" },
  { track: "נופיה - פרח", artist: "Nofia", kind: "title" },
  { track: "נופיה", artist: "פרח", kind: "swapped" },
];
const silent = () => undefined;

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=UTF-8" } });
}

function stubFetch(route: (url: URL) => Response | Promise<Response>) {
  const calls: { url: URL; at: number; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url, at: Date.now(), headers: init.headers as Record<string, string> });
      return route(url);
    }),
  );
  return calls;
}

function siteRoute(url: URL): Response {
  return url.pathname === "/resultsSimple" ? html(SEARCH_HTML) : html(SONG_HTML);
}

function noMatchRoute(): Response {
  return html('<html><head><title>Tab4U</title></head><body><div id="site_wrap"></div></body></html>');
}

beforeEach(() => {
  resetTab4uState();
  mockEnv.TAB4U_MIN_INTERVAL_MS = 0;
  mockEnv.TAB4U_TIMEOUT_MS = 1_000;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseSongLyrics", () => {
  it("keeps lyric lines and stanza breaks and drops chords, tabs, labels and entities", () => {
    expect(parseSongLyrics(SONG_HTML)).toBe(EXPECTED_LYRICS);
  });

  it("returns null for a page without enough lyric lines", () => {
    expect(parseSongLyrics('<div id="songContentTPL"><table><tr><td class="song">שורה</td></tr></table></div>')).toBeNull();
    expect(parseSongLyrics("<html><body>nothing here</body></html>")).toBeNull();
  });
});

describe("parseSearchResults", () => {
  it("reads title, artist and song link from each result once", () => {
    const results = parseSearchResults(SEARCH_HTML);
    expect(results.map((r) => [r.artist, r.title])).toEqual([
      ["זוהר ארגוב", "פרח"],
      ["נופיה ידידיה", "פרח"],
      ["נופיה", "ג'ונאם"],
    ]);
    expect(results[1].href).toMatch(/^tabs\/songs\/76352_.*\.html$/);
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("a&nbsp;b &amp; &#039;c&#x27; &quot;d&quot; &bogus;")).toBe("a b & 'c' \"d\" &bogus;");
  });
});

describe("result picking", () => {
  it("accepts a longer Tab4U artist name and skips the same title by another artist", () => {
    expect(pickTab4uResult(parseSearchResults(SEARCH_HTML), nofia)?.artist).toBe("נופיה ידידיה");
  });

  it("rejects a result whose artist does not match", () => {
    const results = [{ href: "tabs/songs/1_x.html", title: "פרח", artist: "זוהר ארגוב" }];
    expect(pickTab4uResult(results, nofia)).toBeNull();
  });

  it("ignores extra text in parentheses in the Tab4U title", () => {
    expect(titlesMatch("פרח (גרסה אקוסטית)", "פרח")).toBe(true);
    expect(titlesMatch("שתישרף האהבה", "שתשרף האהבה")).toBe(true);
    expect(titlesMatch("פרחים", "פרח")).toBe(false);
  });

  it.each([
    ["נופיה ידידיה", "נופיה", "first_word"],
    ["נופיה", "נופיה", "full"],
    ["ידידיה נופיה", "נופיה", null],
    ["עומר אדם ושלומי שבת", "עומר אדם", "full"],
    ["אייל גולן", "אייל שחר", null],
    ["זוהר ארגוב", "Zohar Argov", null],
  ])("artist %s against %s is %s", (found, wanted, expected) => {
    expect(artistMatch(found, wanted)).toBe(expected);
  });

  it("needs an exact title when the artist matched only by its first word", () => {
    const byOmerAdam = [{ href: "tabs/songs/9_x.html", title: "שתישרף האהבה", artist: "עומר אדם" }];
    expect(pickTab4uResult(byOmerAdam, [{ track: "שתשרף האהבה", artist: "עומר", kind: "split" }])).toBeNull();
    expect(pickTab4uResult(byOmerAdam, [{ track: "שתשרף האהבה", artist: "עומר אדם", kind: "split" }])).not.toBeNull();
    const exact = [{ href: "tabs/songs/8_x.html", title: "פרח (לייב)", artist: "נופיה ידידיה" }];
    expect(pickTab4uResult(exact, nofia)).not.toBeNull();
  });

  it("matches a title without separator only when artist and title explain every Hebrew word", () => {
    const youtube = "אייל גולן יפה שלי Eyal Golan";
    expect(coversWholeTitle({ href: "", title: "יפה שלי", artist: "אייל גולן" }, youtube)).toBe(true);
    expect(coversWholeTitle({ href: "", title: "שלי", artist: "אייל גולן" }, youtube)).toBe(false);
    const candidates: LyricsCandidate[] = [{ track: youtube, artist: "EyalGolanOfficial", kind: "title" }];
    const results = [
      { href: "tabs/songs/1_a.html", title: "שלי", artist: "אייל גולן" },
      { href: "tabs/songs/2_b.html", title: "יפה שלי", artist: "אייל גולן" },
    ];
    expect(pickTab4uResult(results, candidates)?.href).toBe("tabs/songs/2_b.html");
  });
});

describe("searchQueries", () => {
  it("uses Hebrew words only, drops duplicates and caps the number of searches", () => {
    expect(searchQueries(nofia)).toEqual(["נופיה פרח"]);
    const many: LyricsCandidate[] = [
      { track: "שיר אחד", artist: "Some Artist", kind: "split" },
      { track: "שיר שני", artist: "זמר", kind: "split" },
      { track: "שיר שלישי", artist: "זמרת", kind: "split" },
      { track: "English", artist: "זמר", kind: "split" },
    ];
    expect(searchQueries(many)).toEqual(["זמר שיר שני", "זמרת שיר שלישי"]);
  });

  it("drops Latin words and symbols but keeps numbers", () => {
    expect(searchQueries([{ track: "טיפת מזל ♫", artist: "זהבה בן", kind: "split" }])).toEqual(["זהבה בן טיפת מזל"]);
    expect(searchQueries([{ track: "אייל גולן יפה שלי Eyal Golan", artist: "EyalGolanOfficial", kind: "title" }])).toEqual([
      "אייל גולן יפה שלי",
    ]);
    expect(searchQueries([{ track: "בן 32", artist: "עומר אדם", kind: "split" }])).toEqual(["עומר אדם בן 32"]);
  });
});

describe("lookupTab4u", () => {
  it("makes one search and one song page request with a generic User-Agent", async () => {
    const calls = stubFetch(siteRoute);
    const found = await lookupTab4u(nofia, Date.now() + 10_000, silent);
    expect(found).toMatchObject({ kind: "hit", lyrics: EXPECTED_LYRICS });
    expect(calls.map((c) => c.url.pathname)).toEqual(["/resultsSimple", expect.stringMatching(/^\/tabs\/songs\/76352_/)]);
    expect(calls[0].url.searchParams.get("q")).toBe("נופיה פרח");
    expect(calls[0].headers["User-Agent"]).toBe("karaoke-worker/0.2 (self hosted party karaoke)");
  });

  it("stops at the first search when no result matches confidently", async () => {
    const calls = stubFetch(() => html(SEARCH_HTML));
    const found = await lookupTab4u([{ track: "שיר אחר", artist: "מישהו", kind: "split" }], Date.now() + 10_000, silent);
    expect(found).toEqual({ kind: "miss", failure: null });
    expect(calls).toHaveLength(1);
  });

  it("treats a challenge page as a miss and opens the breaker", async () => {
    const logs: string[] = [];
    const calls = stubFetch(() => html("<html><body><div class='g-recaptcha'>please verify captcha</div></body></html>"));
    const found = await lookupTab4u(nofia, Date.now() + 10_000, (m) => logs.push(m));
    expect(found).toEqual({ kind: "miss", failure: "rate_limited" });
    expect(logs.some((l) => l.includes("Tab4U disabled"))).toBe(true);
    expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: null });
    expect(calls).toHaveLength(1);
  });

  it("accepts a normal page that embeds reCAPTCHA", async () => {
    const withRecaptcha = SONG_HTML.replace("</head>", '<script src="https://www.google.com/recaptcha/api.js"></script></head>');
    expect(isChallengePage(withRecaptcha)).toBe(false);
    expect(isChallengePage(SEARCH_HTML)).toBe(false);
    stubFetch((url) => (url.pathname === "/resultsSimple" ? html(SEARCH_HTML) : html(withRecaptcha)));
    expect((await lookupTab4u(nofia, Date.now() + 10_000, silent)).kind).toBe("hit");
  });

  it("recognises a challenge by its title even inside the site shell", () => {
    expect(isChallengePage('<html><head><title>Just a moment...</title></head><body><div id="site_wrap"></div></body></html>')).toBe(true);
  });

  it("treats a redirect to another host as a block", async () => {
    stubFetch(() => {
      const response = html("<html>ok</html>");
      Object.defineProperty(response, "url", { value: "https://verify.example.test/check" });
      return response;
    });
    expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: "rate_limited" });
  });

  it("treats the bare and www hosts as the same site", async () => {
    expect(isSiteHost("tab4u.com")).toBe(true);
    expect(isSiteHost("WWW.Tab4U.com")).toBe(true);
    expect(isSiteHost("tab4u.com.example.test")).toBe(false);
    stubFetch((url) => {
      const response = siteRoute(url);
      Object.defineProperty(response, "url", { value: `https://tab4u.com${url.pathname}` });
      return response;
    });
    expect((await lookupTab4u(nofia, Date.now() + 10_000, silent)).kind).toBe("hit");
  });

  it("does not retry a 4xx response and opens the breaker on 403", async () => {
    const calls = stubFetch(() => html("", 403));
    expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: "rate_limited" });
    expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: null });
    expect(calls).toHaveLength(1);
  });

  it("opens the breaker after three failed lookups in a row", async () => {
    const calls = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    for (let i = 0; i < 3; i += 1) {
      expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: "network_error" });
    }
    expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: null });
    expect(calls).toHaveLength(3);
  });

  it("reports timeouts and does not continue the lookup", async () => {
    const calls = stubFetch(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    expect(await lookupTab4u(nofia, Date.now() + 10_000, silent)).toEqual({ kind: "miss", failure: "timeout" });
    expect(calls).toHaveLength(1);
  });

  it("spaces requests by the minimum interval across concurrent lookups", async () => {
    vi.useFakeTimers();
    mockEnv.TAB4U_MIN_INTERVAL_MS = 2_000;
    const calls = stubFetch(siteRoute);
    const lookups = [1, 2, 3].map(() => lookupTab4u(nofia, Date.now() + 60_000, silent));
    await vi.runAllTimersAsync();
    expect((await Promise.all(lookups)).map((l) => l.kind)).toEqual(["hit", "hit", "hit"]);
    expect(calls).toHaveLength(6);
    for (const [i, call] of calls.slice(1).entries()) expect(call.at - calls[i].at).toBeGreaterThanOrEqual(2_000);
  });

  it("skips instead of sending when too little of the deadline is left", async () => {
    const calls = stubFetch(siteRoute);
    expect(await lookupTab4u(nofia, Date.now() + 1_000, silent)).toEqual({ kind: "miss", failure: null });
    expect(calls).toHaveLength(0);
  });

  it("does not count timeouts caused by the lookup deadline as Tab4U failures", async () => {
    mockEnv.TAB4U_TIMEOUT_MS = 8_000;
    const calls = stubFetch(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    for (let i = 0; i < 4; i += 1) {
      expect(await lookupTab4u(nofia, Date.now() + 3_000, silent)).toEqual({ kind: "miss", failure: "timeout" });
    }
    await lookupTab4u(nofia, Date.now() + 60_000, silent);
    expect(calls).toHaveLength(5);
  });

  it("rechecks the breaker after waiting for a slot", async () => {
    vi.useFakeTimers();
    mockEnv.TAB4U_MIN_INTERVAL_MS = 2_000;
    const calls = stubFetch(() => html("", 403));
    const lookups = [1, 2].map(() => lookupTab4u(nofia, Date.now() + 60_000, silent));
    await vi.runAllTimersAsync();
    expect(await Promise.all(lookups)).toEqual([
      { kind: "miss", failure: "rate_limited" },
      { kind: "miss", failure: null },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("rechecks the deadline after another lookup took the slot", async () => {
    vi.useFakeTimers();
    mockEnv.TAB4U_MIN_INTERVAL_MS = 2_000;
    const calls = stubFetch(noMatchRoute);
    const start = Date.now();
    const lookups = [60_000, 60_000, 5_000].map((budget) => lookupTab4u(nofia, start + budget, silent));
    await vi.runAllTimersAsync();
    await Promise.all(lookups);
    expect(calls.map((c) => c.at - start)).toEqual([0, 2_000]);
  });

  it("makes no request once the lookup deadline has passed", async () => {
    const calls = stubFetch(siteRoute);
    expect(await lookupTab4u(nofia, Date.now() - 1, silent)).toEqual({ kind: "miss", failure: null });
    expect(calls).toHaveLength(0);
  });

  it("moves to the next query when a search returns 404", async () => {
    const candidates: LyricsCandidate[] = [
      { track: "פרח", artist: "מישהו", kind: "split" },
      { track: "פרח", artist: "נופיה", kind: "split" },
    ];
    const calls = stubFetch((url) =>
      url.searchParams.get("q") === "מישהו פרח" ? html("", 404) : siteRoute(url),
    );
    expect((await lookupTab4u(candidates, Date.now() + 10_000, silent)).kind).toBe("hit");
    expect(calls).toHaveLength(3);
  });
});
