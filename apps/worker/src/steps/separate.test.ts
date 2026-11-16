import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {} }));

import { parseSeparateOutput } from "./separate.js";

describe("parseSeparateOutput", () => {
  it("reads both stems from the last stdout line", () => {
    const stdout = 'noise\n{"instrumentalPath": "/w/i.mp3", "vocalsPath": "/w/v.mp3"}\n';
    expect(parseSeparateOutput(stdout, "")).toEqual({ instrumentalPath: "/w/i.mp3", vocalsPath: "/w/v.mp3" });
  });

  it("maps a null vocals path to null", () => {
    const stdout = '{"instrumentalPath": "/w/i.mp3", "vocalsPath": null}';
    expect(parseSeparateOutput(stdout, "")).toEqual({ instrumentalPath: "/w/i.mp3", vocalsPath: null });
  });

  it("rejects output without an instrumental path", () => {
    expect(() => parseSeparateOutput('{"vocalsPath": "/w/v.mp3"}', "")).toThrow(/missing instrumentalPath/);
  });

  it("rejects non JSON output", () => {
    expect(() => parseSeparateOutput("done", "boom")).toThrow(/did not emit JSON/);
  });
});
