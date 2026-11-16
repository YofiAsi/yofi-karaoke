// Reruns only the lyrics lookup for an already processed song.
import type { Task } from "graphile-worker";
import { pool, notify } from "../db.js";
import { fetchLyrics, type LyricsResult } from "../steps/lyrics.js";
import { PgNotifyChannels } from "@karaoke/shared";

interface RefetchLyricsPayload {
  songId: string;
}

interface LyricsQueryRow {
  title: string;
  artist: string;
  track: string | null;
  trackArtist: string | null;
  durationSeconds: number;
}

export async function saveLyrics(songId: string, lyrics: LyricsResult): Promise<void> {
  await pool.query(
    `UPDATE "Song"
        SET "lyricsLrc" = $2,
            "lyricsPlain" = $3,
            "lyricsSource" = $4,
            "lyricsMissReason" = $5
      WHERE id = $1`,
    [songId, lyrics.syncedLyrics, lyrics.plainLyrics, lyrics.source, lyrics.missReason],
  );
}

async function loadLyricsQuery(songId: string): Promise<LyricsQueryRow> {
  const { rows } = await pool.query<LyricsQueryRow>(
    `SELECT title, artist, track, "trackArtist", "durationSeconds"
       FROM "Song" WHERE id = $1`,
    [songId],
  );
  if (rows.length === 0) throw new Error(`song ${songId} not found`);
  return rows[0];
}

export const refetchLyrics: Task = async (payload, helpers) => {
  const { songId } = payload as RefetchLyricsPayload;
  if (!songId) throw new Error("songId missing from payload");

  const query = await loadLyricsQuery(songId);
  const lyrics = await fetchLyrics(query, (msg) => helpers.logger.info(`refetchLyrics ${songId} ${msg}`));
  await saveLyrics(songId, lyrics);
  await notify(PgNotifyChannels.queueUpdated, { reason: "lyrics_refetched", songId });
};
