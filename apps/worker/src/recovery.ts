/* Requeues or fails process_song work left mid step by a dead worker, assuming a single worker replica. */
import type { WorkerUtils } from "graphile-worker";
import { PgNotifyChannels } from "@karaoke/shared";
import { notify, pool } from "./db.js";
import { env } from "./env.js";
import { markSongFailed } from "./queueState.js";
import { planRecovery, staleAfterMs, type GraphileJobRow } from "./recoveryPlan.js";

const ACTIVE_STEPS = ["downloading", "separating", "fetching_lyrics"];
const FAILED_MESSAGE = "worker stopped while processing and no retry is left";
const REQUEUED_MESSAGE = "worker stopped while processing, retrying";

export async function findStaleSongIds(olderThanMs: number, excludeSongIds: string[]): Promise<string[]> {
  const { rows } = await pool.query<{ songId: string }>(
    `SELECT DISTINCT "songId" FROM "ProcessingJob"
      WHERE "completedAt" IS NULL
        AND "step"::text = ANY($1::text[])
        AND "startedAt" IS NOT NULL
        AND "startedAt" < NOW() - make_interval(secs => $2::double precision / 1000)
        AND NOT ("songId" = ANY($3::uuid[]))`,
    [ACTIVE_STEPS, olderThanMs, excludeSongIds],
  );
  return rows.map((r) => r.songId);
}

async function findProcessSongJobs(songIds: string[]): Promise<GraphileJobRow[]> {
  const { rows } = await pool.query<GraphileJobRow>(
    `SELECT key, locked_by AS "lockedBy", attempts, max_attempts AS "maxAttempts"
       FROM graphile_worker.jobs
      WHERE task_identifier = 'process_song' AND key = ANY($1::text[])`,
    [songIds],
  );
  return rows;
}

async function markRequeued(songIds: string[]): Promise<void> {
  await pool.query(
    `UPDATE "ProcessingJob"
        SET "step" = 'pending'::"ProcessingStep",
            "progressPct" = 0,
            "errorMessage" = $2
      WHERE "songId" = ANY($1::uuid[])
        AND "completedAt" IS NULL
        AND "step"::text = ANY($3::text[])`,
    [songIds, REQUEUED_MESSAGE, ACTIVE_STEPS],
  );
}

export async function recoverStaleJobs(utils: WorkerUtils, excludeSongIds: string[]): Promise<void> {
  const stale = await findStaleSongIds(staleAfterMs(env), excludeSongIds);
  if (stale.length === 0) return;

  const plan = planRecovery(stale, await findProcessSongJobs(stale));
  if (plan.requeueSongIds.length > 0) await markRequeued(plan.requeueSongIds);
  if (plan.unlockWorkerIds.length > 0) await utils.forceUnlockWorkers(plan.unlockWorkerIds);
  for (const songId of plan.failSongIds) await markSongFailed(songId, FAILED_MESSAGE);

  console.log(JSON.stringify({ msg: "recovered stale jobs", ...plan }));
  await notify(PgNotifyChannels.queueUpdated, { reason: "stale_jobs" });
}
