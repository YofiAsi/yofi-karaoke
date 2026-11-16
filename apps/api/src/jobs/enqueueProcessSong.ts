import { quickAddJob } from "graphile-worker";
import { env } from "../env.js";

const PROCESS_SONG_MAX_ATTEMPTS = 3;

export async function enqueueProcessSong(songId: string): Promise<void> {
  await quickAddJob(
    { connectionString: env.DATABASE_URL },
    "process_song",
    { songId },
    { jobKey: songId, maxAttempts: PROCESS_SONG_MAX_ATTEMPTS },
  );
}
