/* Pure decisions for recovering process_song work orphaned by a dead worker. */
import { LOOKUP_DEADLINE_MS } from "./steps/lyrics.js";

const STALE_MARGIN_MS = 5 * 60_000;

export interface StepTimeouts {
  DOWNLOAD_TIMEOUT_MS: number;
  SEPARATE_TIMEOUT_MS: number;
}

export interface GraphileJobRow {
  key: string;
  lockedBy: string | null;
  attempts: number;
  maxAttempts: number;
}

export interface RecoveryPlan {
  unlockWorkerIds: string[];
  requeueSongIds: string[];
  failSongIds: string[];
}

export function staleAfterMs(timeouts: StepTimeouts): number {
  return timeouts.DOWNLOAD_TIMEOUT_MS + timeouts.SEPARATE_TIMEOUT_MS + LOOKUP_DEADLINE_MS + STALE_MARGIN_MS;
}

function canRunAgain(job: GraphileJobRow | undefined): job is GraphileJobRow {
  return job !== undefined && job.attempts < job.maxAttempts;
}

export function planRecovery(staleSongIds: string[], jobs: GraphileJobRow[]): RecoveryPlan {
  const jobsByKey = new Map(jobs.map((j) => [j.key, j]));
  const unlock = new Set<string>();
  const plan: RecoveryPlan = { unlockWorkerIds: [], requeueSongIds: [], failSongIds: [] };

  for (const songId of staleSongIds) {
    const job = jobsByKey.get(songId);
    if (!canRunAgain(job)) {
      plan.failSongIds.push(songId);
      continue;
    }
    plan.requeueSongIds.push(songId);
    if (job.lockedBy) unlock.add(job.lockedBy);
  }
  plan.unlockWorkerIds = [...unlock];
  return plan;
}
