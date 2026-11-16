import { describe, expect, it } from "vitest";
import type { QueueItem } from "@karaoke/shared";
import { displayOrigin, upNext } from "./upNext";

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
