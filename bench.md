# Phase 1 Benchmark — Vocal Separation

> Task 1.11 from `plan.md`. **Gate: the `separating` step must complete in < 60s on the Arc A750.** If it doesn't, fall back to the `Kim_Vocal_2` model and re-benchmark; if still over, try `HP5_only_main_vocal_LA` before accepting CPU.

## How to run

1. Bring up dependencies:
   ```bash
   bash scripts/detect-gpu-gids.sh >> .env   # first time only
   docker compose up -d postgres minio
   pnpm --filter api prisma migrate deploy
   docker compose up -d --build worker
   ```
2. Confirm the Arc GPU is visible inside the worker container:
   ```bash
   docker compose exec worker clinfo -l
   # Expect "Intel(R) Arc(TM) A750 Graphics" in output.
   ```
3. Queue a 4-minute test track (via API once Phase 1 is running, or by invoking the task directly):
   ```bash
   # Example direct invocation against a pre-seeded song row:
   docker compose exec postgres psql -U karaoke karaoke -c \
     "SELECT graphile_worker.add_job('process_song', json_build_object('songId','<uuid>'));"
   ```
4. Time each step by tailing worker logs:
   ```bash
   docker compose logs -f worker | tee bench.log
   ```

## Results

Fill in after first real run on the host hardware. Leave unchanged values as `TBD`.

| Model                      | Download | Separate | Lyrics | Upload | Total | Pass? |
|----------------------------|----------|----------|--------|--------|-------|-------|
| UVR-MDX-NET-Inst_HQ_3.onnx | TBD      | TBD      | TBD    | TBD    | TBD   | TBD   |
| Kim_Vocal_2.onnx           | TBD      | TBD      | TBD    | TBD    | TBD   | TBD   |
| HP5_only_main_vocal_LA     | TBD      | TBD      | TBD    | TBD    | TBD   | TBD   |

Host info: kernel, `intel-opencl-icd` version, `clinfo -l` output — paste here once collected.
