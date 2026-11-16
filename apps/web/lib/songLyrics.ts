// Holds the lyrics fetched for one song and exposes them only while that song is current, so no display shows another song's lines.
import type { LyricsWordTimings } from "@karaoke/shared";
import { parseLrc, type LrcLine } from "./lrc";

export interface LyricsResponse {
  lrc: string | null;
  plain: string | null;
  wordTimings?: LyricsWordTimings | null;
  offsetMs?: number;
  source?: string | null;
}

export interface SongLyrics {
  songId: string | null;
  lines: LrcLine[];
  plain: string | null;
  wordTimings: LyricsWordTimings | null;
  source: string | null;
}

export interface ShownLyrics extends Omit<SongLyrics, "songId"> {
  loading: boolean;
}

export const NOT_LOADED: SongLyrics = { songId: null, lines: [], plain: null, wordTimings: null, source: null };

export function noLyricsFor(songId: string | null): SongLyrics {
  return { ...NOT_LOADED, songId };
}

export function lyricsFromResponse(songId: string, response: LyricsResponse): SongLyrics {
  const lines = parseLrc(response.lrc);
  return {
    songId,
    lines,
    plain: response.plain ?? (lines.length === 0 ? response.lrc : null),
    wordTimings: response.wordTimings ?? null,
    source: response.source ?? null,
  };
}

export function shownLyrics(loaded: SongLyrics, currentSongId: string | null): ShownLyrics {
  const { songId, ...lyrics } = loaded;
  if (songId === currentSongId) return { ...lyrics, loading: false };
  return { ...NOT_LOADED, loading: currentSongId !== null };
}
