import { run } from "graphile-worker";
import { PgNotifyChannels } from "@karaoke/shared";
import { notify } from "./db.js";
import { env } from "./env.js";
import { failStaleJobs } from "./queueState.js";
import { processSong } from "./tasks/processSong.js";
import { refetchLyrics } from "./tasks/refetchLyrics.js";

const STALE_JOB_MINUTES = 30;
const STALE_JOB_MESSAGE = "worker restarted while processing";

async function recoverStaleJobs(): Promise<void> {
  const songIds = await failStaleJobs(STALE_JOB_MINUTES, STALE_JOB_MESSAGE);
  if (songIds.length === 0) return;
  console.log(JSON.stringify({ msg: "marked stale jobs failed", songIds }));
  await notify(PgNotifyChannels.queueUpdated, { reason: "stale_jobs" });
}

async function main(): Promise<void> {
  await recoverStaleJobs();
  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 1,
    noHandleSignals: false,
    pollInterval: 1_000,
    taskList: {
      process_song: processSong,
      refetch_lyrics: refetchLyrics,
    },
  });

  console.log(
    JSON.stringify({
      msg: "worker started",
      concurrency: 1,
      model: env.AUDIO_SEP_MODEL,
      backend: env.SEPARATOR_BACKEND,
    }),
  );

  await runner.promise;
}

main().catch((err) => {
  console.error("worker crashed", err);
  process.exit(1);
});
