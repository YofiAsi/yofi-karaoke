import { quickAddJob } from "graphile-worker";
import { env } from "../env.js";

export async function enqueueProcessSong(songId: string): Promise<void> {
  await quickAddJob(
    { connectionString: env.DATABASE_URL },
    "process_song",
    { songId },
  );
}
