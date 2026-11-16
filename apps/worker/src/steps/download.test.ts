import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {} }));

import { ytdlpArgs } from "./download.js";

describe("ytdlpArgs", () => {
  it("extracts wav audio into the template", () => {
    expect(ytdlpArgs("https://youtu.be/x", "out.%(ext)s")).toEqual([
      "-f", "bestaudio", "-x", "--audio-format", "wav", "--no-playlist", "--no-progress", "-o", "out.%(ext)s", "https://youtu.be/x",
    ]);
  });

  it("passes the JavaScript runtime when configured", () => {
    expect(ytdlpArgs("u", "o", "node").slice(0, 2)).toEqual(["--js-runtimes", "node"]);
  });
});
