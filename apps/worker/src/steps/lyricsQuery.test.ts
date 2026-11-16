import { describe, expect, it } from "vitest";
import { buildLyricsCandidates, cleanChannel, cleanTitle, type LyricsCandidate } from "./lyricsQuery.js";

function pairs(candidates: LyricsCandidate[]) {
  return candidates.map(({ artist, track }) => ({ artist, track }));
}

describe("buildLyricsCandidates", () => {
  it("splits an English title and strips noise and feat tails", () => {
    const candidates = buildLyricsCandidates({
      title: "Bruno Mars - Uptown Funk (Official Video) ft. Mark Ronson",
      artist: "Mark Ronson",
    });
    expect(candidates).toEqual([
      { track: "Uptown Funk", artist: "Bruno Mars", kind: "split" },
      { track: "Bruno Mars - Uptown Funk", artist: "Mark Ronson", kind: "title" },
      { track: "Bruno Mars", artist: "Uptown Funk", kind: "swapped" },
    ]);
  });

  it("splits a Hebrew title and strips the official clip suffix", () => {
    const candidates = buildLyricsCandidates({
      title: "חנן בן ארי - אמא אם הייתי (קליפ רשמי)",
      artist: "Hanan Ben Ari - חנן בן ארי",
    });
    expect(candidates[0]).toEqual({ track: "אמא אם הייתי", artist: "חנן בן ארי", kind: "split" });
  });

  it("puts yt-dlp track metadata first", () => {
    const candidates = buildLyricsCandidates({
      title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      artist: "Rick Astley",
      track: "Never Gonna Give You Up",
      trackArtist: "Rick Astley",
    });
    expect(candidates.map((c) => c.kind)).toEqual(["metadata", "title", "swapped"]);
    expect(candidates[0]).toEqual({ track: "Never Gonna Give You Up", artist: "Rick Astley", kind: "metadata" });
  });

  it("falls back to the cleaned channel when metadata has no artist", () => {
    const candidates = buildLyricsCandidates({
      title: "Shape of You",
      artist: "Ed Sheeran - Topic",
      track: "Shape of You",
    });
    expect(pairs(candidates)).toEqual([{ track: "Shape of You", artist: "Ed Sheeran" }]);
  });

  it("drops text after a pipe when it is only noise", () => {
    const candidates = buildLyricsCandidates({
      title: "עומר אדם - שני משוגעים (Prod. by Stav Beger) | הקליפ הרשמי",
      artist: "Omer Adam - עומר אדם",
    });
    expect(pairs(candidates)).toEqual([
      { track: "שני משוגעים", artist: "עומר אדם" },
      { track: "עומר אדם - שני משוגעים", artist: "Omer Adam - עומר אדם" },
      { track: "עומר אדם", artist: "שני משוגעים" },
    ]);
  });

  it("uses both sides of a pipe when each holds a title", () => {
    const candidates = buildLyricsCandidates({
      title: "נועה קירל - טרגדי | Noa Kirel - Tragedy",
      artist: "Noa Kirel",
    });
    expect(pairs(candidates.filter((c) => c.kind === "split"))).toEqual([
      { track: "טרגדי", artist: "נועה קירל" },
      { track: "Tragedy", artist: "Noa Kirel" },
    ]);
  });

  it("adds swapped candidates last for Song - Artist titles", () => {
    const candidates = buildLyricsCandidates({ title: "Tudo Bom - Static & Ben El", artist: "Static & Ben El" });
    expect(candidates.at(-1)).toEqual({ track: "Tudo Bom", artist: "Static & Ben El", kind: "swapped" });
  });

  it("drops split segments that are only noise words", () => {
    expect(pairs(buildLyricsCandidates({ title: "שיר - אמן - קליפ רשמי", artist: "x" }).slice(0, 1))).toEqual([
      { track: "אמן", artist: "שיר" },
    ]);
    const english = buildLyricsCandidates({ title: "Song - Artist Official Video", artist: "Artist" });
    expect(pairs(english)).toContainEqual({ track: "Song", artist: "Artist" });
    expect(english.every((c) => !/official|video/i.test(c.track + c.artist))).toBe(true);
  });

  it("keeps gershayim between Hebrew letters but strips wrapping quotes", () => {
    const candidates = buildLyricsCandidates({ title: 'שב"ק ס - "מרים"', artist: "x" });
    expect(candidates[0]).toEqual({ track: "מרים", artist: 'שב"ק ס', kind: "split" });
  });

  it("handles en dashes, quotes and emoji", () => {
    const candidates = buildLyricsCandidates({
      title: "🔥 Eden Ben Zaken – \"Malka\" [Official Audio] 🔥",
      artist: "Eden Ben Zaken",
    });
    expect(candidates[0]).toEqual({ track: "Malka", artist: "Eden Ben Zaken", kind: "split" });
  });

  it("keeps meaningful brackets such as remix", () => {
    const candidates = buildLyricsCandidates({
      title: "Dua Lipa - Levitating (DaBaby Remix) [Lyric Video]",
      artist: "Dua Lipa",
    });
    expect(pairs(candidates)[0]).toEqual({ track: "Levitating (DaBaby Remix)", artist: "Dua Lipa" });
  });

  it("deduplicates identical candidates case insensitively", () => {
    const candidates = buildLyricsCandidates({
      title: "Adele - Hello",
      artist: "AdeleVEVO",
      track: "hello",
      trackArtist: "adele",
    });
    expect(pairs(candidates)).toEqual([
      { track: "hello", artist: "adele" },
      { track: "Adele - Hello", artist: "Adele" },
      { track: "Adele", artist: "Hello" },
    ]);
  });

  it("returns nothing usable for an empty or noise only title", () => {
    expect(buildLyricsCandidates({ title: "   ", artist: "Someone" })).toEqual([]);
    expect(buildLyricsCandidates({ title: "Official Music Video | HD", artist: "Someone" })).toEqual([]);
  });
});

describe("cleanChannel", () => {
  it.each([
    ["Ed Sheeran - Topic", "Ed Sheeran"],
    ["BrunoMarsVEVO", "Bruno Mars"],
    ["Omer Adam Official", "Omer Adam"],
    ["אייל גולן - הערוץ הרשמי", "אייל גולן"],
    ["נועה קירל", "נועה קירל"],
  ])("cleans %s", (raw, expected) => {
    expect(cleanChannel(raw)).toBe(expected);
  });
});

describe("cleanTitle", () => {
  it.each([
    ["Imagine Dragons - Believer (Official Music Video) [4K]", "Imagine Dragons - Believer"],
    ["נועה קירל - טרגדי (Prod. by Jordi) מילים", "נועה קירל - טרגדי"],
    ["Queen – Bohemian Rhapsody (Remastered 2011)", "Queen – Bohemian Rhapsody"],
    ["Coldplay - Yellow (HD Visualizer)", "Coldplay - Yellow"],
    ["אושר כהן - שיר (Official Video) | Prod by X", "אושר כהן - שיר"],
  ])("cleans %s", (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });
});
