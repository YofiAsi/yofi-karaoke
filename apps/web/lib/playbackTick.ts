// Merges a position tick into the playback state only when it belongs to the current item.
import type { PlaybackStateView, PlaybackTickEvent } from "@karaoke/shared";

export function withTick(
  playback: PlaybackStateView | null,
  tick: PlaybackTickEvent | null,
): PlaybackStateView | null {
  if (!playback || !tick || tick.queueItemId !== playback.currentQueueItemId) return playback;
  return { ...playback, positionSeconds: tick.positionSeconds };
}
