import { pool } from "./db.js";

const UNIQUE_VIOLATION = "23505";

export async function markSongFailed(songId: string, message: string): Promise<void> {
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

export async function markSongReady(songId: string): Promise<void> {
  await pool.query(
    `UPDATE "QueueItem"
       SET "state" = 'ready'::"QueueState"
     WHERE "songId" = $1 AND "state" IN ('queued','processing')`,
    [songId],
  );
  await restoreLatestFailedItem(songId);
}

async function restoreLatestFailedItem(songId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE "QueueItem"
         SET "state" = 'ready'::"QueueState"
       WHERE id = (
         SELECT q.id FROM "QueueItem" q
          WHERE q."songId" = $1 AND q."state" = 'failed'
            AND NOT EXISTS (
              SELECT 1 FROM "QueueItem" a
               WHERE a."songId" = $1 AND a."state" IN ('queued','processing','ready')
            )
          ORDER BY q."createdAt" DESC
          LIMIT 1
       )`,
      [songId],
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}
