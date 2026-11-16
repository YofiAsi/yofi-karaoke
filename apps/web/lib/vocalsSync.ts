// Decides how the vocals element follows the instrumental element, which stays the master clock.
export const VOCALS_SYNC_INTERVAL_MS = 250;
export const VOCALS_MAX_DRIFT_SECONDS = 0.06;
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

export type VocalsAction = "none" | "pause" | "start" | "resync";

export function vocalsActive(gain: number, hasVocals: boolean): boolean {
  return hasVocals && gain > 0;
}

function pastVocalsEnd(instrumental: InstrumentalSnapshot, vocals: VocalsSnapshot): boolean {
  return Number.isFinite(vocals.duration) && instrumental.currentTime >= vocals.duration - END_MARGIN_SECONDS;
}

function drifted(instrumental: InstrumentalSnapshot, vocals: VocalsSnapshot): boolean {
  return Math.abs(vocals.currentTime - instrumental.currentTime) > VOCALS_MAX_DRIFT_SECONDS;
}

function whilePlaying(instrumental: InstrumentalSnapshot, vocals: VocalsSnapshot): VocalsAction {
  if (vocals.paused) return pastVocalsEnd(instrumental, vocals) ? "none" : "start";
  if (vocals.buffering) return "none";
  return drifted(instrumental, vocals) ? "resync" : "none";
}

export function decideVocals(
  active: boolean,
  instrumental: InstrumentalSnapshot,
  vocals: VocalsSnapshot,
): VocalsAction {
  if (!active || instrumental.paused) return vocals.paused ? "none" : "pause";
  return whilePlaying(instrumental, vocals);
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
