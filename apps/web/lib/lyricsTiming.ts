// Picks the active lyric line for a playback position.
import type { LrcLine } from "./lrc";

export const LOOKAHEAD_SECONDS = 0.3;

export function activeLineIndex(lines: readonly LrcLine[], positionSeconds: number, offsetMs: number): number {
  const adjusted = positionSeconds + LOOKAHEAD_SECONDS - offsetMs / 1000;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= adjusted) active = i;
  }
  return active;
}
