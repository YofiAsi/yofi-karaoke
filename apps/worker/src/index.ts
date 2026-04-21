import { run } from "graphile-worker";
import { env } from "./env.js";
import { processSong } from "./tasks/processSong.js";

async function main(): Promise<void> {
  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 1,
    noHandleSignals: false,
    pollInterval: 1_000,
    taskList: {
      process_song: processSong,
    },
  });

  console.log(
    JSON.stringify({
      msg: "worker started",
      concurrency: 1,
      model: env.AUDIO_SEP_MODEL,
      device: env.OV_DEVICE,
    }),
  );

  await runner.promise;
}

main().catch((err) => {
  console.error("worker crashed", err);
  process.exit(1);
});
