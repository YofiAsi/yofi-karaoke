import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle } from "./throttle";

describe("createThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the first value at once and the latest one after the interval", () => {
    const send = vi.fn();
    const throttle = createThrottle(send, 150);
    throttle.push(0.1);
    throttle.push(0.2);
    throttle.push(0.3);
    expect(send.mock.calls).toEqual([[0.1]]);
    vi.advanceTimersByTime(150);
    expect(send.mock.calls).toEqual([[0.1], [0.3]]);
  });

  it("sends about once per interval during a long drag", () => {
    const send = vi.fn();
    const throttle = createThrottle(send, 150);
    for (let i = 0; i < 60; i++) {
      throttle.push(i);
      vi.advanceTimersByTime(10);
    }
    expect(send.mock.calls.length).toBeLessThanOrEqual(5);
    vi.advanceTimersByTime(150);
    expect(send.mock.calls.at(-1)).toEqual([59]);
  });

  it("flushes the pending value on release", () => {
    const send = vi.fn();
    const throttle = createThrottle(send, 150);
    throttle.push(0.1);
    throttle.push(0.6);
    throttle.flush();
    expect(send.mock.calls).toEqual([[0.1], [0.6]]);
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("drops a pending value on cancel", () => {
    const send = vi.fn();
    const throttle = createThrottle(send, 150);
    throttle.push(0.1);
    throttle.push(0.2);
    throttle.cancel();
    vi.advanceTimersByTime(300);
    expect(send.mock.calls).toEqual([[0.1]]);
  });
});
