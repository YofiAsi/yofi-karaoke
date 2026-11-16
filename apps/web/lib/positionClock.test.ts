import { describe, expect, it } from "vitest";
import type { PlaybackStateView } from "@karaoke/shared";
import {
  clockFromState,
  clockFromTick,
  positionAt,
  updateClockOffset,
  type PositionClock,
} from "./positionClock";

const STATE: PlaybackStateView = {
  currentQueueItemId: "item-a",
  positionSeconds: 10,
  isPlaying: true,
  hostUserId: "host",
  playerUserId: "host",
  vocalsGain: 0,
};

const CLOCK: PositionClock = { queueItemId: "item-a", positionSeconds: 10, anchoredAtMs: 1000, isPlaying: true };

describe("positionAt", () => {
  it("advances in real time while playing", () => {
    expect(positionAt(CLOCK, 1500)).toBeCloseTo(10.5);
  });

  it("holds still while paused", () => {
    expect(positionAt({ ...CLOCK, isPlaying: false }, 9000)).toBe(10);
  });

  it("clamps at the song duration", () => {
    expect(positionAt(CLOCK, 1_000_000, 200)).toBe(200);
  });

  it("never runs backwards from an anchor in the future", () => {
    expect(positionAt(CLOCK, 500)).toBe(10);
  });
});

describe("clockFromState", () => {
  it("snaps to the state on the first state and on item change", () => {
    expect(clockFromState(null, STATE, 5000)).toEqual({ ...CLOCK, anchoredAtMs: 5000 });
    const next = clockFromState(CLOCK, { ...STATE, currentQueueItemId: "item-b", positionSeconds: 0 }, 1200);
    expect(next).toEqual({ queueItemId: "item-b", positionSeconds: 0, anchoredAtMs: 1200, isPlaying: true });
  });

  it("snaps on a host seek", () => {
    const next = clockFromState(CLOCK, { ...STATE, positionSeconds: 90 }, 2000);
    expect(next.positionSeconds).toBe(90);
  });

  it("keeps the interpolated position when a state only carries a stale report", () => {
    const next = clockFromState(CLOCK, { ...STATE, positionSeconds: 10.2 }, 2000);
    expect(next.positionSeconds).toBeCloseTo(11);
    expect(next.anchoredAtMs).toBe(2000);
  });

  it("freezes at the interpolated position on pause", () => {
    const next = clockFromState(CLOCK, { ...STATE, isPlaying: false, positionSeconds: 10.4 }, 2000);
    expect(next.isPlaying).toBe(false);
    expect(positionAt(next, 9000)).toBeCloseTo(11);
  });
});

describe("updateClockOffset", () => {
  it("takes the first sample and then the fastest delivery", () => {
    const first = updateClockOffset(null, 10_000, 10_300);
    expect(first).toBe(300);
    expect(updateClockOffset(first, 11_000, 11_250)).toBe(250);
    expect(updateClockOffset(250, 12_000, 12_900)).toBe(255);
  });

  it("handles a client clock behind the server", () => {
    expect(updateClockOffset(null, 50_000, 20_040)).toBe(-29_960);
  });
});

describe("clockFromTick", () => {
  it("anchors the tick at its corrected send time", () => {
    const tick = { queueItemId: "item-a", positionSeconds: 20, serverTimeMs: 50_000 };
    const next = clockFromTick(CLOCK, tick, -29_960);
    expect(next).toEqual({ ...CLOCK, positionSeconds: 20, anchoredAtMs: 20_040 });
    expect(positionAt(next!, 20_540)).toBeCloseTo(20.5);
  });

  it("ignores a late tick for another item", () => {
    const tick = { queueItemId: "item-old", positionSeconds: 180, serverTimeMs: 0 };
    expect(clockFromTick(CLOCK, tick, 0)).toBe(CLOCK);
    expect(clockFromTick(null, tick, 0)).toBeNull();
  });
});
