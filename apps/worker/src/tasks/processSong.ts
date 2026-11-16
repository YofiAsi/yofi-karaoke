import type { JobHelpers, Task } from "graphile-worker";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pool, notify } from "../db.js";
import { env } from "../env.js";
import { downloadYouTubeAudio } from "../steps/download.js";
import { separateVocals } from "../steps/separate.js";
import { fetchLyrics } from "../steps/lyrics.js";
import { uploadStem } from "../minioUpload.js";
import { markSongFailed, markSongReady } from "../queueState.js";
import { decideFailure, type FailureDecision } from "./failurePolicy.js";
import { saveLyrics } from "./refetchLyrics.js";

const activeSongIds = new Set<string>();

export function processingSongIds(): string[] {
  return [...activeSongIds];
}
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
            "startedAt" = CASE WHEN $2 = 'downloading' THEN NOW() ELSE COALESCE(j."startedAt", NOW()) END,
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

interface SongRow {
  id: string;
  youtubeVideoId: string;
  title: string;
  artist: string;
  track: string | null;
  trackArtist: string | null;
  durationSeconds: number;
}

async function loadSong(songId: string): Promise<SongRow | null> {
  const { rows } = await pool.query<SongRow>(
    `SELECT id, "youtubeVideoId", title, artist, track, "trackArtist", "durationSeconds"
     FROM "Song" WHERE id = $1`,
    [songId],
  );
  return rows[0] ?? null;
}

async function uploadStems(
  songId: string,
  stems: { instrumentalPath: string; vocalsPath: string | null },
): Promise<{ instrumentalKey: string; vocalsKey: string | null }> {
  const instrumentalKey = await uploadStem("instrumental", songId, stems.instrumentalPath);
  const vocalsKey = stems.vocalsPath ? await uploadStem("vocals", songId, stems.vocalsPath) : null;
  return { instrumentalKey, vocalsKey };
}

async function runPipeline(songId: string, workDir: string, helpers: JobHelpers): Promise<void> {
  const song = await loadSong(songId);
  if (!song) {
    helpers.logger.warn(`processSong ${songId} skipped: song no longer exists`);
    return;
  }

  await reportProgress(songId, "downloading", 5);
  const { filePath } = await downloadYouTubeAudio(song.youtubeVideoId, workDir);

  await reportProgress(songId, "separating", 35);
  const stems = await separateVocals(workDir, filePath);
  helpers.logger.info(`separate.py wall=${stems.wallMs}ms vocals=${stems.vocalsPath !== null}`);

  await reportProgress(songId, "fetching_lyrics", 80);
  const lyrics = await fetchLyrics(song, (msg) => helpers.logger.info(`processSong ${songId} ${msg}`));

  const { instrumentalKey, vocalsKey } = await uploadStems(songId, stems);

  await saveLyrics(songId, lyrics);
  await pool.query(
    `UPDATE "Song" SET "instrumentalObjectKey" = $2, "vocalsObjectKey" = $3 WHERE id = $1`,
    [songId, instrumentalKey, vocalsKey],
  );

  await markSongReady(songId);
  await reportProgress(songId, "done", 100);
  await broadcastQueueUpdated();
}

async function reportRetry(songId: string, message: string, helpers: JobHelpers): Promise<void> {
  const { attempts, max_attempts } = helpers.job;
  await reportProgress(songId, "pending", 0, `attempt ${attempts}/${max_attempts} failed, retrying: ${message}`);
}

async function reportFinalFailure(songId: string, message: string): Promise<void> {
  await markSongFailed(songId, message);
  await reportProgress(songId, "error", 0, message);
  await broadcastQueueUpdated();
}

async function handleFailure(songId: string, message: string, helpers: JobHelpers): Promise<FailureDecision> {
  const decision = decideFailure(message, {
    attempts: helpers.job.attempts,
    maxAttempts: helpers.job.max_attempts,
  });
  helpers.logger.error(`processSong ${songId} failed (${decision}): ${message}`);
  if (decision === "retry") {
    await reportRetry(songId, message, helpers);
  } else {
    await reportFinalFailure(songId, message);
  }
  return decision;
}

export const processSong: Task = async (payload, helpers) => {
  const { songId } = payload as ProcessSongPayload;
  if (!songId) throw new Error("songId missing from payload");

  const workDir = path.join(env.WORKER_TMP_DIR, songId);
  helpers.logger.info(`processSong ${songId} start attempt ${helpers.job.attempts}/${helpers.job.max_attempts}`);

  activeSongIds.add(songId);
  try {
    await runPipeline(songId, workDir, helpers);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const decision = await handleFailure(songId, message, helpers);
    if (decision !== "unavailable") throw err;
  } finally {
    activeSongIds.delete(songId);
    await rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
};
