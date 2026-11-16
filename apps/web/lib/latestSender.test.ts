import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLatestSender } from "./latestSender";

function controllableSend() {
  const sent: number[] = [];
  const resolvers: (() => void)[] = [];
  const send = (value: number) => {
    sent.push(value);
    return new Promise<void>((resolve) => resolvers.push(resolve));
  };
  async function settleNext() {
    resolvers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  return { sent, send, settleNext, inFlight: () => resolvers.length };
}

describe("createLatestSender", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never has two requests in flight", async () => {
    const api = controllableSend();
    const sender = createLatestSender(api.send, 150);
    sender.push(0.1);
    vi.advanceTimersByTime(500);
    sender.push(0.2);
    sender.push(0.3);
    vi.advanceTimersByTime(500);
    expect(api.sent).toEqual([0.1]);
    expect(api.inFlight()).toBe(1);
    await api.settleNext();
    expect(api.sent).toEqual([0.1, 0.3]);
  });

  it("waits the interval between sends", async () => {
    const api = controllableSend();
    const sender = createLatestSender(api.send, 150);
    sender.push(0.1);
    await api.settleNext();
    sender.push(0.2);
    expect(api.sent).toEqual([0.1]);
    vi.advanceTimersByTime(150);
    expect(api.sent).toEqual([0.1, 0.2]);
  });

  it("sends the final value on release right after the request in flight settles", async () => {
    const api = controllableSend();
    const sender = createLatestSender(api.send, 150);
    sender.push(0.1);
    sender.push(0.6);
    sender.flush();
    expect(api.sent).toEqual([0.1]);
    await api.settleNext();
    expect(api.sent).toEqual([0.1, 0.6]);
  });

  it("keeps sending after a failed request", async () => {
    const sent: number[] = [];
    const sender = createLatestSender((value: number) => {
      sent.push(value);
      return Promise.reject(new Error("offline"));
    }, 150);
    sender.push(0.1);
    sender.push(0.2);
    sender.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([0.1, 0.2]);
  });

  it("drops the pending value on cancel", async () => {
    const api = controllableSend();
    const sender = createLatestSender(api.send, 150);
    sender.push(0.1);
    sender.push(0.2);
    sender.cancel();
    await api.settleNext();
    vi.advanceTimersByTime(500);
    expect(api.sent).toEqual([0.1]);
  });
});
