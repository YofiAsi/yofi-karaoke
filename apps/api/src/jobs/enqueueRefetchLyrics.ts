import { makeWorkerUtils } from "graphile-worker";
import { env } from "../env.js";

const REFETCH_PRIORITY = 10;

export async function enqueueRefetchLyrics(songIds: string[], spacingMs = 0): Promise<void> {
  if (songIds.length === 0) return;
  const utils = await makeWorkerUtils({ connectionString: env.DATABASE_URL });
  try {
    const startAt = Date.now();
    for (const [index, songId] of songIds.entries()) {
      await utils.addJob(
        "refetch_lyrics",
        { songId },
        {
          jobKey: `refetch_lyrics:${songId}`,
          runAt: new Date(startAt + index * spacingMs),
          priority: REFETCH_PRIORITY,
          maxAttempts: 3,
        },
      );
    }
  } finally {
    await utils.release();
  }
}
