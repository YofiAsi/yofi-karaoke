import { describe, expect, it } from "vitest";
import type { PlaybackStateView } from "@karaoke/shared";
import { clockForItem, lyricsPositionFor } from "./lyricsPosition";
import type { PositionClock } from "./positionClock";

const PLAYBACK = { currentQueueItemId: "item-b", positionSeconds: 3, isPlaying: true } as PlaybackStateView;

function clockOf(queueItemId: string): PositionClock {
  return { queueItemId, positionSeconds: 90, anchoredAtMs: 0, isPlaying: true, freshUntilMs: 3000 };
}

describe("lyricsPositionFor", () => {
  it("uses the player tick of the current item", () => {
    expect(lyricsPositionFor("item-b", { queueItemId: "item-b", seconds: 12 }, PLAYBACK)).toBe(12);
  });

  it("ignores a tick left over from the previous item after a skip", () => {
    expect(lyricsPositionFor("item-b", { queueItemId: "item-a", seconds: 140 }, PLAYBACK)).toBe(3);
  });

  it("starts at zero while the playback state still describes the previous item", () => {
    const stale = { ...PLAYBACK, currentQueueItemId: "item-a", positionSeconds: 140 };
    expect(lyricsPositionFor("item-b", { queueItemId: "item-a", seconds: 140 }, stale)).toBe(0);
    expect(lyricsPositionFor("item-b", null, null)).toBe(0);
  });

  it("is zero without a current item", () => {
    expect(lyricsPositionFor(null, { queueItemId: "item-a", seconds: 140 }, PLAYBACK)).toBe(0);
  });
});

describe("clockForItem", () => {
  it("keeps the clock of the current item", () => {
    const clock = clockOf("item-b");
    expect(clockForItem("item-b", clock)).toBe(clock);
  });

  it("drops a clock anchored to another item", () => {
    expect(clockForItem("item-b", clockOf("item-a"))).toBeNull();
    expect(clockForItem(null, clockOf("item-a"))).toBeNull();
    expect(clockForItem("item-b", null)).toBeNull();
  });
});
