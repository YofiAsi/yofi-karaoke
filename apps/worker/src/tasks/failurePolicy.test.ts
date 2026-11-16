import { describe, expect, it } from "vitest";
import { decideFailure, isFinalAttempt, isVideoUnavailableMessage } from "./failurePolicy.js";

describe("isFinalAttempt", () => {
  it.each([
    [1, 3, false],
    [2, 3, false],
    [3, 3, true],
    [4, 3, true],
    [1, 1, true],
  ])("attempts=%i max=%i -> %s", (attempts, maxAttempts, expected) => {
    expect(isFinalAttempt({ attempts, maxAttempts })).toBe(expected);
  });
});

describe("isVideoUnavailableMessage", () => {
  it.each([
    "ERROR: [youtube] abc: Video unavailable",
    "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
    "Join this channel to get access to members-only content",
    "This video is available to this channel's members only",
    "ERROR: This video is not available",
  ])("matches %s", (message) => {
    expect(isVideoUnavailableMessage(message)).toBe(true);
  });

  it("ignores transient errors", () => {
    expect(isVideoUnavailableMessage("HTTP Error 503: Service Unavailable")).toBe(false);
    expect(isVideoUnavailableMessage("separate.py timed out after 180000ms")).toBe(false);
  });
});

describe("decideFailure", () => {
  it("retries a transient error before the last attempt", () => {
    expect(decideFailure("timeout", { attempts: 1, maxAttempts: 3 })).toBe("retry");
  });

  it("is final on the last attempt", () => {
    expect(decideFailure("timeout", { attempts: 3, maxAttempts: 3 })).toBe("final");
  });

  it("stops at once for an unavailable video", () => {
    expect(decideFailure("Video unavailable", { attempts: 1, maxAttempts: 3 })).toBe("unavailable");
  });
});
