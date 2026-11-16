/* Worker entry: runs process_song and refetch_lyrics jobs concurrently while all GPU work shares one sidecar. */
import { makeWorkerUtils, run, type WorkerUtils } from "graphile-worker";
import { env } from "./env.js";
import { killGpuNow, stopGpu } from "./gpu/index.js";
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
  process.once("exit", killGpuNow);
  const utils = await makeWorkerUtils({ connectionString: env.DATABASE_URL });
  await utils.migrate();
  await recoverStaleJobs(utils, []);

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: env.WORKER_CONCURRENCY,
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
      concurrency: env.WORKER_CONCURRENCY,
      gpuLane: "serial",
      model: env.AUDIO_SEP_MODEL,
      backend: env.SEPARATOR_BACKEND,
    }),
  );

  try {
    await runner.promise;
  } finally {
    clearInterval(recoveryTimer);
    await stopGpu();
    await utils.release();
  }
}

main().catch((err) => {
  console.error("worker crashed", err);
  process.exit(1);
});
