// Decides which line each of the two karaoke slots shows at a lyrics time, and the countdown before a line after a long gap.
import type { KaraokeLine } from "./karaokeLines";

export const COUNTDOWN_GAP_SECONDS = 8;
export const COUNTDOWN_SECONDS = 3;
export const COUNTDOWN_DOTS = 3;
export const GAP_HOLD_SECONDS = 1.5;

export type SlotRole = "current" | "next";

export interface SlotContent {
  lineIndex: number;
  role: SlotRole;
}

export type SlotPair = [SlotContent | null, SlotContent | null];

export function currentLineIndex(lines: readonly KaraokeLine[], time: number): number {
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= time) current = i;
  }
  return current;
}

export function gapBefore(lines: readonly KaraokeLine[], index: number): number {
  return index === 0 ? lines[0].start : lines[index].start - lines[index - 1].end;
}

function isLongGap(lines: readonly KaraokeLine[], index: number): boolean {
  return gapBefore(lines, index) >= COUNTDOWN_GAP_SECONDS;
}

function heldPastEnd(line: KaraokeLine, time: number): boolean {
  return time >= line.end + GAP_HOLD_SECONDS;
}

export function pivotIndex(lines: readonly KaraokeLine[], time: number): number {
  if (lines.length === 0) return -1;
  const current = currentLineIndex(lines, time);
  if (current < 0) return 0;
  const next = current + 1;
  if (next < lines.length && isLongGap(lines, next) && heldPastEnd(lines[current], time)) return next;
  return current;
}

export function slotContents(lines: readonly KaraokeLine[], time: number): SlotPair {
  const slots: SlotPair = [null, null];
  const pivot = pivotIndex(lines, time);
  if (pivot < 0) return slots;
  slots[pivot % 2] = { lineIndex: pivot, role: "current" };
  if (pivot + 1 < lines.length) slots[(pivot + 1) % 2] = { lineIndex: pivot + 1, role: "next" };
  return slots;
}

export function countdownDots(lines: readonly KaraokeLine[], time: number): number | null {
  const upcoming = lines.findIndex((line) => line.start > time);
  if (upcoming < 0) return null;
  if (upcoming > 0 && !isLongGap(lines, upcoming)) return null;
  const remaining = lines[upcoming].start - time;
  if (remaining > COUNTDOWN_SECONDS) return null;
  return Math.ceil(remaining / (COUNTDOWN_SECONDS / COUNTDOWN_DOTS));
}
