// Processes one queued song: download, stems on the GPU lane, lyrics lookup in parallel, then timed lyrics; ready only when all of it is done.
import type { JobHelpers, Task } from "graphile-worker";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pool, notify } from "../db.js";
import { env } from "../env.js";
import { downloadYouTubeAudio } from "../steps/download.js";
import { prewarmSeparation, separateVocals, type SeparateResult } from "../steps/separate.js";
import { fetchLyrics, type LyricsLogger } from "../steps/lyrics.js";
import { addTimedLyrics, transcriptionEnabled, wordTimingsFor } from "../steps/timedLyrics.js";
import { romanizeLyrics } from "../steps/romaji.js";
import { songPriority } from "../gpu/index.js";
import { withSongLock } from "../songLock.js";
import { uploadStem } from "../storage/index.js";
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
  const [instrumentalKey, vocalsKey] = await Promise.all([
    uploadStem("instrumental", songId, stems.instrumentalPath),
    stems.vocalsPath ? uploadStem("vocals", songId, stems.vocalsPath) : null,
  ]);
  return { instrumentalKey, vocalsKey };
}

type StageTimes = Record<string, number>;

async function timed<T>(stages: StageTimes, name: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    stages[name] = Date.now() - started;
  }
}

function joinLater<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => void 0);
  return promise;
}

async function bothOrFirstError<A, B>(a: Promise<A>, b: Promise<B>): Promise<[A, B]> {
  const [first, second] = await Promise.allSettled([a, b]);
  if (first.status === "rejected") throw first.reason;
  if (second.status === "rejected") throw second.reason;
  return [first.value, second.value];
}

function willTranscribe(stems: SeparateResult): boolean {
  return transcriptionEnabled() && stems.vocalsPath !== null;
}

function timedSync<T>(stages: StageTimes, name: string, work: () => T): T {
  const started = Date.now();
  try {
    return work();
  } finally {
    stages[name] = Date.now() - started;
  }
}

function describeSeparation(stems: SeparateResult): string {
  return `separate wall=${stems.wallMs}ms queued=${stems.queuedMs}ms load=${stems.loadMs}ms inference=${stems.inferenceMs}ms encode=${stems.encodeMs}ms vocals=${stems.vocalsPath !== null}`;
}

async function runPipeline(songId: string, workDir: string, helpers: JobHelpers): Promise<void> {
  const song = await loadSong(songId);
  if (!song) {
    helpers.logger.warn(`processSong ${songId} skipped: song no longer exists`);
    return;
  }
  const started = Date.now();
  const stages: StageTimes = {};
  const priority = songPriority(helpers.job);
  const log: LyricsLogger = (msg) => helpers.logger.info(`processSong ${songId} ${msg}`);

  await reportProgress(songId, "downloading", 5);
  prewarmSeparation(priority);
  const lookup = joinLater(timed(stages, "lyricsLookupMs", () => fetchLyrics(song, log)));
  const { filePath } = await timed(stages, "downloadMs", () => downloadYouTubeAudio(song.youtubeVideoId, workDir));

  await reportProgress(songId, "separating", 35);
  const stems = await timed(stages, "separateMs", () => separateVocals(workDir, filePath, priority));
  helpers.logger.info(`processSong ${songId} ${describeSeparation(stems)}`);

  await reportProgress(songId, "fetching_lyrics", 80);
  const found = await timed(stages, "lyricsWaitMs", () => lookup);
  if (willTranscribe(stems)) await reportProgress(songId, "fetching_lyrics", 90);
  const [timedLyrics, { instrumentalKey, vocalsKey }] = await bothOrFirstError(
    timed(stages, "timedLyricsMs", () => addTimedLyrics(song, found, stems.vocalsPath, log, priority)),
    timed(stages, "uploadMs", () => uploadStems(songId, stems)),
  );
  const lyrics = await timed(stages, "romajiMs", () => romanizeLyrics(timedLyrics.lyrics, log));
  const wordTimings = timedSync(stages, "wordTimingsMs", () => wordTimingsFor(lyrics, timedLyrics, song.durationSeconds, log));

  await saveLyrics(songId, lyrics, wordTimings);
  await pool.query(
    `UPDATE "Song" SET "instrumentalObjectKey" = $2, "vocalsObjectKey" = $3 WHERE id = $1`,
    [songId, instrumentalKey, vocalsKey],
  );

  await markSongReady(songId);
  await reportProgress(songId, "done", 100);
  await broadcastQueueUpdated();
  helpers.logger.info(`processSong ${songId} stages ${JSON.stringify({ ...stages, totalMs: Date.now() - started })}`);
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

async function processLocked(songId: string, helpers: JobHelpers): Promise<void> {
  const workDir = path.join(env.WORKER_TMP_DIR, songId);
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
}

export const processSong: Task = async (payload, helpers) => {
  const { songId } = payload as ProcessSongPayload;
  if (!songId) throw new Error("songId missing from payload");
  helpers.logger.info(`processSong ${songId} start attempt ${helpers.job.attempts}/${helpers.job.max_attempts}`);
  await withSongLock(songId, () => processLocked(songId, helpers));
};
