import { describe, it, expect, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { HOST_PIN: "2468" } }));

import { authorizeHostPin, pinsMatch } from "./hostPin.js";
import { createAttemptLimiter } from "./attemptLimiter.js";

function freshLimiter(now = () => 0) {
  return createAttemptLimiter(3, 1000, now);
}

describe("pinsMatch()", () => {
  it("accepts the exact PIN", () => {
    expect(pinsMatch("2468", "2468")).toBe(true);
  });

  it("rejects a different PIN, including one of another length", () => {
    expect(pinsMatch("2469", "2468")).toBe(false);
    expect(pinsMatch("24680", "2468")).toBe(false);
    expect(pinsMatch("", "2468")).toBe(false);
  });
});

describe("authorizeHostPin()", () => {
  it("allows the correct PIN", () => {
    expect(authorizeHostPin("ip", "2468", freshLimiter())).toBeNull();
  });

  it("asks for a PIN when none is given", () => {
    expect(authorizeHostPin("ip", undefined, freshLimiter())).toEqual({
      status: 403,
      error: "pin_required",
    });
  });

  it("rejects a wrong PIN", () => {
    expect(authorizeHostPin("ip", "0000", freshLimiter())).toEqual({
      status: 403,
      error: "invalid_pin",
    });
  });

  it("blocks a client after repeated wrong PINs, even with the right one", () => {
    const limiter = freshLimiter();
    for (let i = 0; i < 3; i++) authorizeHostPin("ip", "0000", limiter);
    expect(authorizeHostPin("ip", "2468", limiter)).toEqual({
      status: 429,
      error: "too_many_attempts",
    });
    expect(authorizeHostPin("other-ip", "2468", limiter)).toBeNull();
  });

  it("unblocks a client once the failure window passes", () => {
    let clock = 0;
    const limiter = freshLimiter(() => clock);
    for (let i = 0; i < 3; i++) authorizeHostPin("ip", "0000", limiter);
    clock = 1001;
    expect(authorizeHostPin("ip", "2468", limiter)).toBeNull();
  });

  it("does not count a missing PIN as a failed guess", () => {
    const limiter = freshLimiter();
    for (let i = 0; i < 5; i++) authorizeHostPin("ip", undefined, limiter);
    expect(authorizeHostPin("ip", "2468", limiter)).toBeNull();
  });
});
