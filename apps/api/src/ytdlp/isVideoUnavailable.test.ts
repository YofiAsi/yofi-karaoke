import { describe, expect, it } from "vitest";
import { isYtVideoUnavailableMessage } from "./isVideoUnavailable.js";

describe("isYtVideoUnavailableMessage", () => {
  it("detects common yt-dlp messages", () => {
    expect(
      isYtVideoUnavailableMessage(
        "ERROR: [youtube] x: Video unavailable. This video is private.",
      ),
    ).toBe(true);
    expect(isYtVideoUnavailableMessage("Private video")).toBe(true);
    expect(isYtVideoUnavailableMessage("members-only")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isYtVideoUnavailableMessage("timed out")).toBe(false);
    expect(isYtVideoUnavailableMessage("network unreachable")).toBe(false);
  });
});
