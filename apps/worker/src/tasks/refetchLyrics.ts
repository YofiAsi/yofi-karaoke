// Reruns only the lyrics lookup for an already processed song, never downgrading stored lyrics.
import type { Task } from "graphile-worker";
import { pool, notify } from "../db.js";
import { fetchLyrics, TRANSIENT_MISS_REASONS, type LyricsResult } from "../steps/lyrics.js";
import { PgNotifyChannels } from "@karaoke/shared";

interface RefetchLyricsPayload {
  songId: string;
}

interface StoredLyricsRow {
  title: string;
  artist: string;
  track: string | null;
  trackArtist: string | null;
  durationSeconds: number;
  lyricsLrc: string | null;
  lyricsPlain: string | null;
}

export type RefetchDecision = "save" | "keep" | "retry";

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

export function decideRefetch(
  stored: Pick<StoredLyricsRow, "lyricsLrc" | "lyricsPlain">,
  fresh: LyricsResult,
): RefetchDecision {
  if (fresh.missReason && TRANSIENT_MISS_REASONS.has(fresh.missReason)) return "retry";
  const freshRank = lyricsRank(fresh.syncedLyrics, fresh.plainLyrics);
  return freshRank >= lyricsRank(stored.lyricsLrc, stored.lyricsPlain) ? "save" : "keep";
}

function lyricsRank(synced: string | null, plain: string | null): number {
  if (synced?.trim()) return 2;
  if (plain?.trim()) return 1;
  return 0;
}

async function loadStoredLyrics(songId: string): Promise<StoredLyricsRow> {
  const { rows } = await pool.query<StoredLyricsRow>(
    `SELECT title, artist, track, "trackArtist", "durationSeconds", "lyricsLrc", "lyricsPlain"
       FROM "Song" WHERE id = $1`,
    [songId],
  );
  if (rows.length === 0) throw new Error(`song ${songId} not found`);
  return rows[0];
}

export const refetchLyrics: Task = async (payload, helpers) => {
  const { songId } = payload as RefetchLyricsPayload;
  if (!songId) throw new Error("songId missing from payload");

  const stored = await loadStoredLyrics(songId);
  const lyrics = await fetchLyrics(stored, (msg) => helpers.logger.info(`refetchLyrics ${songId} ${msg}`));
  const decision = decideRefetch(stored, lyrics);

  if (decision === "retry") {
    throw new Error(`lyrics refetch for ${songId} hit a transient failure (${lyrics.missReason}); retrying later`);
  }
  if (decision === "keep") {
    helpers.logger.info(`refetchLyrics ${songId} kept stored lyrics; new result (${lyrics.source}) is worse`);
    return;
  }
  await saveLyrics(songId, lyrics);
  await notify(PgNotifyChannels.queueUpdated, { reason: "lyrics_refetched", songId });
};
