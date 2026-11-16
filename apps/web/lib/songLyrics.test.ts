import { describe, expect, it } from "vitest";
import { lyricsFromResponse, noLyricsFor, NOT_LOADED, shownLyrics } from "./songLyrics";

const LOADED_A = lyricsFromResponse("song-a", { lrc: "[00:01.00]paper moon", plain: null, source: "lrclib" });

describe("shownLyrics", () => {
  it("shows the loaded lyrics while their song is current", () => {
    const shown = shownLyrics(LOADED_A, "song-a");
    expect(shown.loading).toBe(false);
    expect(shown.lines).toEqual([{ time: 1, text: "paper moon" }]);
    expect(shown.source).toBe("lrclib");
  });

  it("hides the previous song's lines after a song change while the new ones load", () => {
    const shown = shownLyrics(LOADED_A, "song-b");
    expect(shown).toMatchObject({ lines: [], plain: null, wordTimings: null, loading: true });
  });

  it("reports no lyrics only once the current song's answer is known", () => {
    expect(shownLyrics(noLyricsFor("song-b"), "song-b")).toMatchObject({ lines: [], loading: false });
  });

  it("is not loading without a current song", () => {
    expect(shownLyrics(NOT_LOADED, null).loading).toBe(false);
  });

  it("keeps an unparseable LRC as plain text", () => {
    expect(lyricsFromResponse("s", { lrc: "just words", plain: null }).plain).toBe("just words");
  });
});
