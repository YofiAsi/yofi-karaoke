// Client side checks for lyrics the host pastes, matching the API limit.

export const MAX_MANUAL_LYRICS_CHARS = 10_000;

export type ManualLyricsCheck = { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" };

export function checkManualLyrics(raw: string): ManualLyricsCheck {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_MANUAL_LYRICS_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}

export function isAutomaticLyrics(source: string | null | undefined): boolean {
  return source === "whisper";
}
