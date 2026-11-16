import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {} }));

import { toSeparatedStems } from "./separate.js";

describe("toSeparatedStems", () => {
  it("reads both stems from the sidecar result", () => {
    expect(toSeparatedStems({ instrumentalPath: "/w/i.mp3", vocalsPath: "/w/v.mp3", inferenceMs: 3 })).toEqual({
      instrumentalPath: "/w/i.mp3",
      vocalsPath: "/w/v.mp3",
    });
  });

  it("maps a null vocals path to null", () => {
    expect(toSeparatedStems({ instrumentalPath: "/w/i.mp3", vocalsPath: null })).toEqual({ instrumentalPath: "/w/i.mp3", vocalsPath: null });
  });

  it("rejects a result without an instrumental path", () => {
    expect(() => toSeparatedStems({ vocalsPath: "/w/v.mp3" })).toThrow(/missing instrumentalPath/);
    expect(() => toSeparatedStems(null)).toThrow(/missing instrumentalPath/);
  });
});
