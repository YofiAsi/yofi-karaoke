// Picks the lyrics position for the current queue item and ignores positions that belong to another item.
import type { PlaybackStateView } from "@karaoke/shared";
import type { PositionClock } from "./positionClock";

export interface PlayerTick {
  queueItemId: string;
  seconds: number;
}

export function lyricsPositionFor(
  itemId: string | null,
  tick: PlayerTick | null,
  playback: PlaybackStateView | null,
): number {
  if (!itemId) return 0;
  if (tick?.queueItemId === itemId) return tick.seconds;
  return playback?.currentQueueItemId === itemId ? playback.positionSeconds : 0;
}

export function clockForItem(itemId: string | null, clock: PositionClock | null): PositionClock | null {
  return clock && itemId && clock.queueItemId === itemId ? clock : null;
}
