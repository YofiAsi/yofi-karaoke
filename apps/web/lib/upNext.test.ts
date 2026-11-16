import { describe, expect, it } from "vitest";
import type { QueueItem } from "@karaoke/shared";
import { displayOrigin, isLoopbackHost, upNext } from "./upNext";

function item(id: string, state: QueueItem["state"]): QueueItem {
  return { id, state } as QueueItem;
}

describe("upNext", () => {
  it("skips failed items and keeps queue order up to the count", () => {
    const queue = [item("a", "ready"), item("b", "failed"), item("c", "processing"), item("d", "queued"), item("e", "ready")];
    expect(upNext(queue, 3).map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(upNext([], 3)).toEqual([]);
  });
});

describe("displayOrigin", () => {
  it("drops the scheme for a short join address", () => {
    expect(displayOrigin("https://karaoke.example.com")).toBe("karaoke.example.com");
    expect(displayOrigin("http://192.168.1.20:3000")).toBe("192.168.1.20:3000");
  });
});

describe("isLoopbackHost", () => {
  it("flags addresses phones cannot reach", () => {
    for (const host of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("accepts lan and public hosts", () => {
    for (const host of ["192.168.1.20", "karaoke.example.com", "10.0.0.5", "localhost.example.com"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});
