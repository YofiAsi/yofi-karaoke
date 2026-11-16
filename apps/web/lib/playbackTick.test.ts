import { describe, expect, it } from "vitest";
import { withTick } from "./playbackTick";

const PLAYBACK = {
  currentQueueItemId: "item-b",
  positionSeconds: 0,
  isPlaying: true,
  hostUserId: "host",
  playerUserId: "host",
  vocalsGain: 0,
};

describe("withTick", () => {
  it("applies a tick for the current item", () => {
    expect(withTick(PLAYBACK, { queueItemId: "item-b", positionSeconds: 12, serverTimeMs: 0 })?.positionSeconds).toBe(12);
  });

  it("ignores a late tick for the previous item", () => {
    expect(withTick(PLAYBACK, { queueItemId: "item-a", positionSeconds: 180, serverTimeMs: 0 })).toBe(PLAYBACK);
  });

  it("passes the state through without a tick", () => {
    expect(withTick(PLAYBACK, null)).toBe(PLAYBACK);
    expect(withTick(null, { queueItemId: "item-b", positionSeconds: 1, serverTimeMs: 0 })).toBeNull();
  });
});
