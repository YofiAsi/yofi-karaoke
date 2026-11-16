// Continuous playback position for frame driven lyrics: the stem engine on the player device, the interpolated clock elsewhere.
import { LOOKAHEAD_SECONDS } from "./lyricsTiming";
import { positionAt, type PositionClock } from "./positionClock";

export interface PlayerPositionReader {
  queueItemId: string;
  read: () => number;
}

export interface LiveSources {
  clock: PositionClock | null;
  reader: PlayerPositionReader | null;
  fallbackSeconds: number;
  durationSeconds?: number;
}

export function readerForItem(itemId: string | null, reader: PlayerPositionReader | null): PlayerPositionReader | null {
  return reader && itemId && reader.queueItemId === itemId ? reader : null;
}

export function readLivePosition(sources: LiveSources, nowMs: number): number {
  if (sources.reader) return sources.reader.read();
  if (sources.clock) return positionAt(sources.clock, nowMs, sources.durationSeconds);
  return sources.fallbackSeconds;
}

export function fillTime(positionSeconds: number, offsetMs: number): number {
  return positionSeconds - offsetMs / 1000;
}

export function lyricsTime(positionSeconds: number, offsetMs: number): number {
  return fillTime(positionSeconds, offsetMs) + LOOKAHEAD_SECONDS;
}
