import { describe, expect, it } from "vitest";
import { buildLyricsCandidates, cleanChannel, cleanTitle } from "./lyricsQuery.js";

describe("buildLyricsCandidates", () => {
  it("splits an English title and strips noise and feat tails", () => {
    const candidates = buildLyricsCandidates({
      title: "Bruno Mars - Uptown Funk (Official Video) ft. Mark Ronson",
      artist: "Mark Ronson",
    });
    expect(candidates[0]).toEqual({ track: "Uptown Funk", artist: "Bruno Mars" });
    expect(candidates[1]).toEqual({ track: "Bruno Mars - Uptown Funk", artist: "Mark Ronson" });
  });

  it("splits a Hebrew title and strips the official clip suffix", () => {
    const candidates = buildLyricsCandidates({
      title: "חנן בן ארי - אמא אם הייתי (קליפ רשמי)",
      artist: "Hanan Ben Ari - חנן בן ארי",
    });
    expect(candidates[0]).toEqual({ track: "אמא אם הייתי", artist: "חנן בן ארי" });
  });

  it("puts yt-dlp track metadata first", () => {
    const candidates = buildLyricsCandidates({
      title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      artist: "Rick Astley",
      track: "Never Gonna Give You Up",
      trackArtist: "Rick Astley",
    });
    expect(candidates).toEqual([
      { track: "Never Gonna Give You Up", artist: "Rick Astley" },
      { track: "Rick Astley - Never Gonna Give You Up", artist: "Rick Astley" },
    ]);
  });

  it("falls back to the cleaned channel when metadata has no artist", () => {
    const candidates = buildLyricsCandidates({
      title: "Shape of You",
      artist: "Ed Sheeran - Topic",
      track: "Shape of You",
    });
    expect(candidates).toEqual([{ track: "Shape of You", artist: "Ed Sheeran" }]);
  });

  it("drops text after a pipe and Hebrew producer credits", () => {
    const candidates = buildLyricsCandidates({
      title: "עומר אדם - שני משוגעים (Prod. by Stav Beger) | הקליפ הרשמי",
      artist: "Omer Adam - עומר אדם",
    });
    expect(candidates[0]).toEqual({ track: "שני משוגעים", artist: "עומר אדם" });
  });

  it("handles en dashes, quotes and emoji", () => {
    const candidates = buildLyricsCandidates({
      title: "🔥 Eden Ben Zaken – \"Malka\" [Official Audio] 🔥",
      artist: "Eden Ben Zaken",
    });
    expect(candidates[0]).toEqual({ track: "Malka", artist: "Eden Ben Zaken" });
  });

  it("keeps meaningful brackets such as remix", () => {
    const candidates = buildLyricsCandidates({
      title: "Dua Lipa - Levitating (DaBaby Remix) [Lyric Video]",
      artist: "Dua Lipa",
    });
    expect(candidates[0]).toEqual({ track: "Levitating (DaBaby Remix)", artist: "Dua Lipa" });
  });

  it("deduplicates identical candidates case insensitively", () => {
    const candidates = buildLyricsCandidates({
      title: "Adele - Hello",
      artist: "AdeleVEVO",
      track: "hello",
      trackArtist: "adele",
    });
    expect(candidates).toEqual([
      { track: "hello", artist: "adele" },
      { track: "Adele - Hello", artist: "Adele" },
    ]);
  });

  it("returns nothing usable for an empty title", () => {
    expect(buildLyricsCandidates({ title: "   ", artist: "Someone" })).toEqual([]);
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
    ["נועה קירל - טרגדי (Prod. by Jordi) מילים", "נועה קירל - טרגדי מילים"],
    ["Queen – Bohemian Rhapsody (Remastered 2011)", "Queen – Bohemian Rhapsody"],
    ["Coldplay - Yellow (HD Visualizer)", "Coldplay - Yellow"],
    ["אושר כהן - שיר (Official Video) | Prod by X", "אושר כהן - שיר"],
  ])("cleans %s", (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });
});
