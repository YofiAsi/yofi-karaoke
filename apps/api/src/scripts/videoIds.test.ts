import { describe, expect, it } from "vitest";
import { parseVideoIds } from "./videoIds.js";

describe("parseVideoIds", () => {
  it("reads bare ids, one per line", () => {
    expect(parseVideoIds("abcdefghijk\r\nABC-def_123\n")).toEqual(["abcdefghijk", "ABC-def_123"]);
  });

  it("reads ids out of the common link shapes", () => {
    const text = [
      "https://www.youtube.com/watch?v=abcdefghijk&list=PL123",
      "https://youtu.be/bbbbbbbbbbb?t=10",
      "https://www.youtube.com/shorts/ccccccccccc",
      "https://music.youtube.com/watch?feature=share&v=ddddddddddd",
    ].join("\n");
    expect(parseVideoIds(text)).toEqual(["abcdefghijk", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"]);
  });

  it("takes the first field of a database export row", () => {
    expect(parseVideoIds("abcdefghijk|Some Artist - Some Song\nbbbbbbbbbbb, Another Song")).toEqual([
      "abcdefghijk",
      "bbbbbbbbbbb",
    ]);
  });

  it("skips blank lines, headers and anything that is not an id", () => {
    expect(parseVideoIds("youtubeVideoId\n\n(2 rows)\nSome Artist - Some Song\ntooshort\nabcdefghijk")).toEqual([
      "abcdefghijk",
    ]);
  });

  it("keeps each id once, in first seen order", () => {
    expect(parseVideoIds("bbbbbbbbbbb\nabcdefghijk\nhttps://youtu.be/bbbbbbbbbbb")).toEqual([
      "bbbbbbbbbbb",
      "abcdefghijk",
    ]);
  });
});
