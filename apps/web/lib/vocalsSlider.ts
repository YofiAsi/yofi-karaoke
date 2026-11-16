// Slider text and the rule for when a broadcast gain may overwrite the local slider value.
export const VOCALS_SEND_INTERVAL_MS = 150;
export const VOCALS_SETTLE_MS = 1000;
const SAME_GAIN_EPSILON = 1e-6;

export function vocalsValueText(gain: number): string {
  const percent = Math.round(gain * 100);
  return percent === 0 ? "Muted" : `${percent} percent`;
}

export interface LocalSend {
  gain: number;
  atMs: number;
}

export function acceptsServerGain(
  serverGain: number,
  dragging: boolean,
  lastSend: LocalSend | null,
  nowMs: number,
): boolean {
  if (dragging) return false;
  if (!lastSend) return true;
  if (Math.abs(serverGain - lastSend.gain) < SAME_GAIN_EPSILON) return true;
  return nowMs - lastSend.atMs > VOCALS_SETTLE_MS;
}

export function vocalsUnavailableText(hasVocals: boolean, failed: boolean): string | null {
  if (!hasVocals) return "This song has no separate vocals track, so only the instrumental plays.";
  if (failed) return "The vocals track failed to load on the player, so only the instrumental plays.";
  return null;
}
