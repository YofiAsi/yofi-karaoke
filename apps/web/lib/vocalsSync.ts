// Decides how the vocals element follows the instrumental element, which stays the master clock.
export const VOCALS_SYNC_INTERVAL_MS = 250;
export const VOCALS_MAX_DRIFT_SECONDS = 0.06;
export const RESYNC_COOLDOWN_MS = 1000;
const WIDEST_DRIFT_SECONDS = 0.25;
const MAX_SEEK_LEAD_SECONDS = 0.15;
const SEEK_LEAD_SMOOTHING = 0.5;
const END_MARGIN_SECONDS = 0.1;

export interface InstrumentalSnapshot {
  paused: boolean;
  currentTime: number;
}

export interface VocalsSnapshot {
  paused: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
}

export interface ResyncHistory {
  lastSeekAtMs: number;
  consecutive: number;
  leadSeconds: number;
}

export const FRESH_RESYNC_HISTORY: ResyncHistory = {
  lastSeekAtMs: Number.NEGATIVE_INFINITY,
  consecutive: 0,
  leadSeconds: 0,
};

export type VocalsAction = "none" | "pause" | "start" | "resync";

export function vocalsActive(gain: number, hasVocals: boolean): boolean {
  return hasVocals && gain > 0;
}

export function driftThreshold(consecutive: number): number {
  return Math.min(VOCALS_MAX_DRIFT_SECONDS * 2 ** consecutive, WIDEST_DRIFT_SECONDS);
}

function driftOf(instrumental: InstrumentalSnapshot, vocals: VocalsSnapshot): number {
  return Math.abs(vocals.currentTime - instrumental.currentTime);
}

function pastVocalsEnd(instrumental: InstrumentalSnapshot, vocals: VocalsSnapshot): boolean {
  return Number.isFinite(vocals.duration) && instrumental.currentTime >= vocals.duration - END_MARGIN_SECONDS;
}

function coolingDown(history: ResyncHistory, nowMs: number): boolean {
  return nowMs - history.lastSeekAtMs < RESYNC_COOLDOWN_MS;
}

function whilePlaying(
  instrumental: InstrumentalSnapshot,
  vocals: VocalsSnapshot,
  history: ResyncHistory,
  nowMs: number,
): VocalsAction {
  if (vocals.paused) return pastVocalsEnd(instrumental, vocals) ? "none" : "start";
  if (vocals.buffering || coolingDown(history, nowMs)) return "none";
  return driftOf(instrumental, vocals) > driftThreshold(history.consecutive) ? "resync" : "none";
}

export function decideVocals(
  active: boolean,
  instrumental: InstrumentalSnapshot,
  vocals: VocalsSnapshot,
  history: ResyncHistory = FRESH_RESYNC_HISTORY,
  nowMs = 0,
): VocalsAction {
  if (!active || instrumental.paused) return vocals.paused ? "none" : "pause";
  return whilePlaying(instrumental, vocals, history, nowMs);
}

function inSync(instrumental: InstrumentalSnapshot, vocals: VocalsSnapshot): boolean {
  return !vocals.paused && !vocals.buffering && driftOf(instrumental, vocals) <= VOCALS_MAX_DRIFT_SECONDS;
}

export function recordCheck(
  history: ResyncHistory,
  action: VocalsAction,
  instrumental: InstrumentalSnapshot,
  vocals: VocalsSnapshot,
  nowMs: number,
): ResyncHistory {
  if (action === "start") return { ...history, lastSeekAtMs: nowMs, consecutive: 0 };
  if (action === "resync") return { ...history, lastSeekAtMs: nowMs, consecutive: history.consecutive + 1 };
  if (action === "none" && inSync(instrumental, vocals) && history.consecutive > 0) {
    return { ...history, consecutive: 0 };
  }
  return history;
}

export function seekTarget(instrumentalTime: number, history: ResyncHistory): number {
  return instrumentalTime + history.leadSeconds;
}

export function withSeekLatency(history: ResyncHistory, latencyMs: number): ResyncHistory {
  const measured = Math.max(0, latencyMs) / 1000;
  const smoothed = history.leadSeconds * (1 - SEEK_LEAD_SMOOTHING) + measured * SEEK_LEAD_SMOOTHING;
  return { ...history, leadSeconds: Math.min(smoothed, MAX_SEEK_LEAD_SECONDS) };
}

const HAVE_FUTURE_DATA = 3;

type MediaLike = Pick<HTMLMediaElement, "paused" | "seeking" | "readyState" | "currentTime" | "duration">;

function waitingForData(el: MediaLike): boolean {
  return el.seeking || el.readyState < HAVE_FUTURE_DATA;
}

export function instrumentalSnapshot(el: MediaLike): InstrumentalSnapshot {
  return { paused: el.paused || waitingForData(el), currentTime: el.currentTime };
}

export function vocalsSnapshot(el: MediaLike): VocalsSnapshot {
  return { paused: el.paused, buffering: waitingForData(el), currentTime: el.currentTime, duration: el.duration };
}
