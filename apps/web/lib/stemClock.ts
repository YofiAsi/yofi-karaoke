// Pure position arithmetic for stems scheduled on an AudioContext clock: a frozen offset, or an offset anchored at a context time.
export interface StemClock {
  durationSeconds: number;
  offsetSeconds: number;
  anchoredAt: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function snapToFrame(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate) / sampleRate;
}

export function nextFrameTime(seconds: number, sampleRate: number): number {
  return Math.ceil(seconds * sampleRate - 1e-6) / sampleRate;
}

export function pausedClock(durationSeconds: number, offsetSeconds = 0): StemClock {
  return { durationSeconds, offsetSeconds: clamp(offsetSeconds, 0, durationSeconds), anchoredAt: null };
}

export function isRunning(clock: StemClock): boolean {
  return clock.anchoredAt !== null;
}

export function clockPosition(clock: StemClock, now: number): number {
  if (clock.anchoredAt === null) return clock.offsetSeconds;
  const elapsed = Math.max(0, now - clock.anchoredAt);
  return clamp(clock.offsetSeconds + elapsed, 0, clock.durationSeconds);
}

export function startClock(clock: StemClock, when: number): StemClock {
  if (clock.anchoredAt !== null) return clock;
  return { ...clock, anchoredAt: when };
}

export function pauseClock(clock: StemClock, now: number): StemClock {
  return pausedClock(clock.durationSeconds, clockPosition(clock, now));
}

export function seekClock(clock: StemClock, seconds: number, when: number): StemClock {
  const paused = pausedClock(clock.durationSeconds, seconds);
  return clock.anchoredAt === null ? paused : startClock(paused, when);
}

export function hasReachedEnd(clock: StemClock, now: number): boolean {
  return clockPosition(clock, now) >= clock.durationSeconds;
}
