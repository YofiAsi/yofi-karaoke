import type { Task } from "graphile-worker";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pool, notify } from "../db.js";
import { env } from "../env.js";
import { downloadYouTubeAudio } from "../steps/download.js";
import { separateVocals } from "../steps/separate.js";
import { fetchLyrics } from "../steps/lyrics.js";
import { uploadInstrumental } from "../minioUpload.js";
import {
  PgNotifyChannels,
  type SongProgressEvent,
  type ProcessingStep,
} from "@karaoke/shared";

interface ProcessSongPayload {
  songId: string;
}

async function reportProgress(
  songId: string,
  step: ProcessingStep,
  progressPct: number,
  errorMessage: string | null = null,
): Promise<void> {
  await pool.query(
    `WITH latest AS (
       SELECT id FROM "ProcessingJob"
       WHERE "songId" = $1
       ORDER BY "startedAt" DESC NULLS LAST
       LIMIT 1
     ),
     upsert AS (
       INSERT INTO "ProcessingJob" ("id","songId","step","progressPct","errorMessage","startedAt","completedAt")
       SELECT gen_random_uuid(), $1, $2::"ProcessingStep", $3, $4, NOW(),
              CASE WHEN $2 IN ('done','error') THEN NOW() ELSE NULL END
       WHERE NOT EXISTS (SELECT 1 FROM latest)
       RETURNING id
     )
     UPDATE "ProcessingJob" j
        SET "step" = $2::"ProcessingStep",
            "progressPct" = $3,
            "errorMessage" = $4,
            "startedAt" = COALESCE(j."startedAt", NOW()),
            "completedAt" = CASE WHEN $2 IN ('done','error') THEN NOW() ELSE j."completedAt" END
       FROM latest
      WHERE j.id = latest.id`,
    [songId, step, progressPct, errorMessage],
  );

  const payload: SongProgressEvent = {
    songId,
    step,
    progressPct,
    errorMessage: errorMessage ?? null,
  };
  await notify(PgNotifyChannels.songProgress, payload);
}

async function broadcastQueueUpdated(): Promise<void> {
  await notify(PgNotifyChannels.queueUpdated, { reason: "process_song" });
}

async function markQueueItemsFailed(songId: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE "QueueItem"
       SET "state" = 'failed'::"QueueState"
     WHERE "songId" = $1 AND "state" IN ('queued','processing')`,
    [songId],
  );
  await pool.query(
    `UPDATE "ProcessingJob"
       SET "step" = 'error'::"ProcessingStep",
           "errorMessage" = $2,
           "completedAt" = NOW()
     WHERE "songId" = $1 AND "completedAt" IS NULL`,
    [songId, message],
  );
}

async function markQueueItemsReady(songId: string): Promise<void> {
  await pool.query(
    `UPDATE "QueueItem"
       SET "state" = 'ready'::"QueueState"
     WHERE "songId" = $1 AND "state" IN ('queued','processing')`,
    [songId],
  );
}

interface SongRow {
  id: string;
  youtubeVideoId: string;
  title: string;
  artist: string;
  durationSeconds: number;
}

async function loadSong(songId: string): Promise<SongRow> {
  const { rows } = await pool.query<SongRow>(
    `SELECT id, "youtubeVideoId", title, artist, "durationSeconds"
     FROM "Song" WHERE id = $1`,
    [songId],
  );
  if (rows.length === 0) throw new Error(`song ${songId} not found`);
  return rows[0];
}

export const processSong: Task = async (payload, helpers) => {
  const { songId } = payload as ProcessSongPayload;
  if (!songId) throw new Error("songId missing from payload");

  const workDir = path.join(env.WORKER_TMP_DIR, songId);
  helpers.logger.info(`processSong ${songId} start`);

  try {
    const song = await loadSong(songId);

    await reportProgress(songId, "downloading", 5);
    const { filePath } = await downloadYouTubeAudio(song.youtubeVideoId);

    await reportProgress(songId, "separating", 35);
    const { instrumentalPath, wallMs } = await separateVocals(songId, filePath);
    helpers.logger.info(`separate.py wall=${wallMs}ms`);

    await reportProgress(songId, "fetching_lyrics", 80);
    const lyrics = await fetchLyrics({
      title: song.title,
      artist: song.artist,
      durationSeconds: song.durationSeconds,
    });

    const instrumentalKey = await uploadInstrumental(songId, instrumentalPath);

    await pool.query(
      `UPDATE "Song"
         SET "instrumentalObjectKey" = $2,
             "lyricsLrc" = $3,
             "lyricsSource" = $4
       WHERE id = $1`,
      [songId, instrumentalKey, lyrics.syncedLyrics, lyrics.source],
    );

    await markQueueItemsReady(songId);
    await reportProgress(songId, "done", 100);
    await broadcastQueueUpdated();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    helpers.logger.error(`processSong ${songId} failed: ${message}`);
    await markQueueItemsFailed(songId, message);
    await reportProgress(songId, "error", 0, message);
    await broadcastQueueUpdated();
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
};
