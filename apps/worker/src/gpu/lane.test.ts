import { describe, expect, it } from "vitest";
import { GpuLane } from "./lane.js";

function deferred() {
  let resolve: () => void = () => void 0;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const song = (order: number) => ({ tier: 0, order });

describe("GpuLane", () => {
  it("never runs two tasks at once", async () => {
    const lane = new GpuLane();
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    };
    await Promise.all([1, 2, 3, 4, 5].map((n) => lane.run(song(n), task)));
    expect(peak).toBe(1);
  });

  it("serves the earliest song first, then first come first served, and refetches last", async () => {
    const lane = new GpuLane();
    const gate = deferred();
    const order: string[] = [];
    const record = (name: string) => async () => void order.push(name);
    const first = lane.run(song(5), () => gate.promise.then(() => void order.push("busy")));
    const rest = [
      lane.run({ tier: 1, order: 1 }, record("refetch")),
      lane.run(song(9), record("song 9")),
      lane.run(song(3), record("song 3 a")),
      lane.run(song(3), record("song 3 b")),
    ];
    expect(lane.queued).toBe(4);
    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual(["busy", "song 3 a", "song 3 b", "song 9", "refetch"]);
  });

  it("keeps going after a task fails or throws synchronously", async () => {
    const lane = new GpuLane();
    const failing = lane.run(song(1), async () => {
      throw new Error("cuda oom");
    });
    const throwing = lane.run(song(2), () => {
      throw new Error("sync");
    });
    const next = lane.run(song(3), async () => "ok");
    await expect(failing).rejects.toThrow("cuda oom");
    await expect(throwing).rejects.toThrow("sync");
    await expect(next).resolves.toBe("ok");
  });
});
