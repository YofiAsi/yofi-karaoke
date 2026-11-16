import { describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({ env: { YTDLP_BIN: "yt-dlp", YTDLP_TIMEOUT_MS: 1000 } }));

import { withJsRuntimes } from "./ytdlp.js";

describe("withJsRuntimes", () => {
  it("puts the configured JavaScript runtime in front of the arguments", () => {
    expect(withJsRuntimes(["--dump-single-json", "url"], "node")).toEqual(["--js-runtimes", "node", "--dump-single-json", "url"]);
  });

  it("leaves the arguments alone when no runtime is configured", () => {
    const args = ["--dump-single-json", "url"];
    expect(withJsRuntimes(args, undefined)).toBe(args);
  });
});
