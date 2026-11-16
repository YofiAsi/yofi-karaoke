import { describe, it, expect, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { HOST_PIN: "246810" } }));

import { authorizeHostPin, pinsMatch } from "./hostPin.js";
import { clientKeyFromIp, createAttemptLimiter } from "./attemptLimiter.js";

const RIGHT = "246810";
const WRONG = "000000";

function freshLimiter(now = () => 0, overrides: Partial<{ maxFailuresGlobal: number; maxKeys: number }> = {}) {
  return createAttemptLimiter({
    maxFailuresPerKey: 3,
    maxFailuresGlobal: 10,
    windowMs: 1000,
    maxKeys: 100,
    now,
    ...overrides,
  });
}

function failTimes(limiter: ReturnType<typeof freshLimiter>, ip: string, times: number) {
  for (let i = 0; i < times; i++) authorizeHostPin(ip, WRONG, limiter);
}

describe("pinsMatch()", () => {
  it("accepts the exact PIN", () => {
    expect(pinsMatch(RIGHT, RIGHT)).toBe(true);
  });

  it("rejects a different PIN, including one of another length", () => {
    expect(pinsMatch("246811", RIGHT)).toBe(false);
    expect(pinsMatch("2468100", RIGHT)).toBe(false);
    expect(pinsMatch("", RIGHT)).toBe(false);
  });
});

describe("authorizeHostPin()", () => {
  it("allows the correct PIN", () => {
    expect(authorizeHostPin("1.2.3.4", RIGHT, freshLimiter())).toBeNull();
  });

  it("asks for a PIN when none is given", () => {
    expect(authorizeHostPin("1.2.3.4", undefined, freshLimiter())).toEqual({
      status: 403,
      error: "pin_required",
    });
  });

  it("rejects a wrong PIN", () => {
    expect(authorizeHostPin("1.2.3.4", WRONG, freshLimiter())).toEqual({
      status: 403,
      error: "invalid_pin",
    });
  });

  it("blocks a client after repeated wrong PINs, even with the right one", () => {
    const limiter = freshLimiter();
    failTimes(limiter, "1.2.3.4", 3);
    expect(authorizeHostPin("1.2.3.4", RIGHT, limiter)).toEqual({
      status: 429,
      error: "too_many_attempts",
    });
    expect(authorizeHostPin("5.6.7.8", RIGHT, limiter)).toBeNull();
  });

  it("unblocks a client once the failure window passes", () => {
    let clock = 0;
    const limiter = freshLimiter(() => clock);
    failTimes(limiter, "1.2.3.4", 3);
    clock = 1001;
    expect(authorizeHostPin("1.2.3.4", RIGHT, limiter)).toBeNull();
  });

  it("does not count a missing PIN as a failed guess", () => {
    const limiter = freshLimiter();
    for (let i = 0; i < 5; i++) authorizeHostPin("1.2.3.4", undefined, limiter);
    expect(authorizeHostPin("1.2.3.4", RIGHT, limiter)).toBeNull();
  });

  it("locks every host claim once the global ceiling is reached across spoofed addresses", () => {
    let clock = 0;
    const limiter = freshLimiter(() => clock);
    for (let i = 0; i < 10; i++) authorizeHostPin(`10.0.0.${i}`, WRONG, limiter);
    expect(authorizeHostPin("192.168.1.50", RIGHT, limiter)).toEqual({
      status: 429,
      error: "too_many_attempts",
    });
    clock = 1001;
    expect(authorizeHostPin("192.168.1.50", RIGHT, limiter)).toBeNull();
  });

  it("shares one budget across an IPv6 /64", () => {
    const limiter = freshLimiter();
    authorizeHostPin("2001:db8:1:2::1", WRONG, limiter);
    authorizeHostPin("2001:db8:1:2:aaaa::2", WRONG, limiter);
    authorizeHostPin("2001:0db8:0001:0002:ffff:ffff:ffff:ffff", WRONG, limiter);
    expect(authorizeHostPin("2001:db8:1:2::99", RIGHT, limiter)?.status).toBe(429);
    expect(authorizeHostPin("2001:db8:1:3::1", RIGHT, limiter)).toBeNull();
  });
});

describe("createAttemptLimiter()", () => {
  it("caps tracked keys by evicting the oldest entries", () => {
    const limiter = freshLimiter(() => 0, { maxKeys: 3, maxFailuresGlobal: 1000 });
    for (const key of ["a", "b", "c", "d"]) limiter.recordFailure(key);
    expect(limiter.trackedKeys()).toBe(3);
    limiter.recordFailure("d");
    limiter.recordFailure("d");
    expect(limiter.isBlocked("d")).toBe(true);
    for (let i = 0; i < 2; i++) limiter.recordFailure("b");
    expect(limiter.isBlocked("b")).toBe(true);
    limiter.recordFailure("e");
    expect(limiter.trackedKeys()).toBe(3);
    expect(limiter.isBlocked("b")).toBe(false);
  });
});

describe("clientKeyFromIp()", () => {
  it("keeps IPv4 addresses as is", () => {
    expect(clientKeyFromIp("192.168.1.10")).toBe("192.168.1.10");
  });

  it("unwraps IPv4 mapped IPv6 addresses", () => {
    expect(clientKeyFromIp("::ffff:192.168.1.10")).toBe("192.168.1.10");
  });

  it("reduces IPv6 addresses to their /64 prefix", () => {
    expect(clientKeyFromIp("2001:db8:1:2:3:4:5:6")).toBe("2001:0db8:0001:0002::/64");
    expect(clientKeyFromIp("2001:DB8:1:2::")).toBe("2001:0db8:0001:0002::/64");
    expect(clientKeyFromIp("::1")).toBe("0000:0000:0000:0000::/64");
    expect(clientKeyFromIp("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
  });
});
