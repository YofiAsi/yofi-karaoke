import { makeWorkerUtils, run, type WorkerUtils } from "graphile-worker";
import { env } from "./env.js";
import { recoverStaleJobs } from "./recovery.js";
import { processingSongIds, processSong } from "./tasks/processSong.js";
import { refetchLyrics } from "./tasks/refetchLyrics.js";

const RECOVERY_INTERVAL_MS = 60_000;

function scheduleRecovery(utils: WorkerUtils): NodeJS.Timeout {
  return setInterval(() => {
    recoverStaleJobs(utils, processingSongIds()).catch((err) => console.error("stale job recovery failed", err));
  }, RECOVERY_INTERVAL_MS);
}

async function main(): Promise<void> {
  const utils = await makeWorkerUtils({ connectionString: env.DATABASE_URL });
  await utils.migrate();
  await recoverStaleJobs(utils, []);

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
  const recoveryTimer = scheduleRecovery(utils);

  console.log(
    JSON.stringify({
      msg: "worker started",
      concurrency: 1,
      model: env.AUDIO_SEP_MODEL,
      backend: env.SEPARATOR_BACKEND,
    }),
  );

  try {
    await runner.promise;
  } finally {
    clearInterval(recoveryTimer);
    await utils.release();
  }
}

main().catch((err) => {
  console.error("worker crashed", err);
  process.exit(1);
});
