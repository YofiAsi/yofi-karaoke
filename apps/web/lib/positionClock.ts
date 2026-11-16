// Estimates the playback position on devices without audio from playback state and 1 Hz ticks, on a monotonic clock.
import type { PlaybackStateView, PlaybackTickEvent } from "@karaoke/shared";

export const STATE_SNAP_SECONDS = 2;
export const EXTRAPOLATION_LIMIT_MS = 3000;
const OFFSET_DRIFT_ALLOWANCE_MS = 5;

export interface PositionClock {
  queueItemId: string | null;
  positionSeconds: number;
  anchoredAtMs: number;
  isPlaying: boolean;
  freshUntilMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function positionAt(clock: PositionClock, nowMs: number, durationSeconds?: number): number {
  const until = Math.min(nowMs, clock.freshUntilMs);
  const elapsed = clock.isPlaying ? Math.max(0, until - clock.anchoredAtMs) / 1000 : 0;
  const max = durationSeconds && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  return clamp(clock.positionSeconds + elapsed, 0, max);
}

function snapTo(state: PlaybackStateView, nowMs: number): PositionClock {
  return {
    queueItemId: state.currentQueueItemId,
    positionSeconds: state.positionSeconds,
    anchoredAtMs: nowMs,
    isPlaying: state.isPlaying,
    freshUntilMs: nowMs + EXTRAPOLATION_LIMIT_MS,
  };
}

function freshUntilAfterState(prev: PositionClock, state: PlaybackStateView, nowMs: number): number {
  const resumed = !prev.isPlaying && state.isPlaying;
  return resumed ? nowMs + EXTRAPOLATION_LIMIT_MS : prev.freshUntilMs;
}

export function clockFromState(
  prev: PositionClock | null,
  state: PlaybackStateView,
  nowMs: number,
): PositionClock {
  if (!prev || prev.queueItemId !== state.currentQueueItemId) return snapTo(state, nowMs);
  const predicted = positionAt(prev, nowMs);
  if (Math.abs(predicted - state.positionSeconds) > STATE_SNAP_SECONDS) return snapTo(state, nowMs);
  return {
    ...prev,
    positionSeconds: predicted,
    anchoredAtMs: nowMs,
    isPlaying: state.isPlaying,
    freshUntilMs: freshUntilAfterState(prev, state, nowMs),
  };
}

export function updateClockOffset(prevOffsetMs: number | null, serverTimeMs: number, receivedAtMs: number): number {
  const sample = receivedAtMs - serverTimeMs;
  return prevOffsetMs === null ? sample : Math.min(sample, prevOffsetMs + OFFSET_DRIFT_ALLOWANCE_MS);
}

export function clockFromTick(
  prev: PositionClock | null,
  tick: PlaybackTickEvent,
  offsetMs: number,
): PositionClock | null {
  if (!prev || prev.queueItemId !== tick.queueItemId) return prev;
  const anchoredAtMs = tick.serverTimeMs + offsetMs;
  return {
    ...prev,
    positionSeconds: tick.positionSeconds,
    anchoredAtMs,
    freshUntilMs: anchoredAtMs + EXTRAPOLATION_LIMIT_MS,
  };
}
