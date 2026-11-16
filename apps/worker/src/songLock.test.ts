import { describe, expect, it } from "vitest";
import { withSongLock } from "./songLock.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withSongLock", () => {
  it("runs work for the same song one after another and other songs alongside", async () => {
    const log: string[] = [];
    const job = (song: string, name: string, ms: number) =>
      withSongLock(song, async () => {
        log.push(`${name} start`);
        await pause(ms);
        log.push(`${name} end`);
        return name;
      });
    const results = await Promise.all([job("a", "a1", 20), job("a", "a2", 1), job("b", "b1", 1)]);
    expect(results).toEqual(["a1", "a2", "b1"]);
    expect(log.indexOf("a2 start")).toBeGreaterThan(log.indexOf("a1 end"));
    expect(log.indexOf("b1 end")).toBeLessThan(log.indexOf("a1 end"));
  });

  it("releases the lock when the work fails", async () => {
    await expect(withSongLock("c", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(withSongLock("c", async () => "next")).resolves.toBe("next");
  });
});
