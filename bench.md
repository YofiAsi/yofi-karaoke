# Phase 1 Benchmark — Vocal Separation

> Task 1.11 from `plan.md`. **Gate: the `separating` step must complete in < 60s.** If it doesn't, fall back to the `Kim_Vocal_2` model and re-benchmark; if still over, try `HP5_only_main_vocal_LA` before accepting CPU.

## How to run

1. Bring up dependencies:
   ```bash
   bash scripts/detect-gpu-gids.sh >> .env   # Intel/Arc path only (first time)
   docker compose up -d postgres minio
   pnpm --filter api prisma:migrate
   # Intel/Arc + OpenVINO:
   docker compose up -d --build worker
   # or NVIDIA + CUDA:
   docker compose -f docker-compose.nvidia.yml up -d --build worker
   ```
2. Confirm the GPU is visible inside the worker container:
   ```bash
   # Intel/Arc:
   docker compose exec worker clinfo -l
   # Expect "Intel(R) Arc(TM) A750 Graphics".
   # NVIDIA:
   docker compose -f docker-compose.nvidia.yml exec worker nvidia-smi
   ```
3. Queue a 4-minute test track (via API once Phase 1 is running, or by invoking the task directly):
   ```bash
   docker compose exec postgres psql -U karaoke karaoke -c \
     "SELECT graphile_worker.add_job('process_song', json_build_object('songId','<uuid>'));"
   ```
4. Time each step by tailing worker logs:
   ```bash
   docker compose logs -f worker | tee bench.log
   ```
5. Read wall times back from the DB:
   ```bash
   docker compose exec -T postgres psql -U karaoke karaoke -c \
     "SELECT s.title, s.\"durationSeconds\",
             EXTRACT(EPOCH FROM (j.\"completedAt\" - j.\"startedAt\")) AS total_s,
             j.step
        FROM \"ProcessingJob\" j
        JOIN \"Song\" s ON s.id = j.\"songId\"
       ORDER BY j.\"startedAt\" DESC LIMIT 5;"
   ```
   and separate-step wall time from the `separate.py wall=…ms` log line.

## Results

Runs captured on 2026-04-22 against live YouTube sources. Separate wall time is the `separate.py wall=…ms` log; Total is `ProcessingJob.completedAt − startedAt` (covers download + separate + lyrics + upload + DB writes).

| Model                      | Song duration | Run  | Separate wall | Total pipeline | Pass? |
|----------------------------|---------------|------|---------------|----------------|-------|
| UVR-MDX-NET-Inst_HQ_3.onnx | 10 s          | cold | 42.7 s        | 45.8 s         | ✅ <60s |
| UVR-MDX-NET-Inst_HQ_3.onnx | 275 s (4:35)  | warm | 15.9 s        | 20.6 s         | ✅ <60s |
| Kim_Vocal_2.onnx           | —             | —    | not needed    | not needed     | n/a   |
| HP5_only_main_vocal_LA     | —             | —    | not needed    | not needed     | n/a   |

Notes:

- The cold run pays a one-time ONNX / CUDA EP model-load cost. Subsequent jobs in the same worker process reuse the loaded model and separate at roughly real-time / 17× (275s audio → 16s wall).
- Gate is met on the first candidate model (`UVR-MDX-NET-Inst_HQ_3`), so fallback models weren't benchmarked. If a future regression pushes separate > 60s, rerun this table for `Kim_Vocal_2` before touching other code.

## Host info

- Kernel: `6.6.87.2-microsoft-standard-WSL2` (WSL2 on Windows host)
- GPU backend: **NVIDIA CUDA** via `docker-compose.nvidia.yml` / `apps/worker/Dockerfile.nvidia` (`SEPARATOR_BACKEND=cuda`, `nvidia/cuda:12.6.0-runtime-ubuntu22.04`)
- `clinfo` not applicable on this path (OpenCL/OpenVINO tooling only ships in the Intel/Arc image). Sanity check GPU with `docker compose -f docker-compose.nvidia.yml exec worker nvidia-smi`.
- Python deps: see `apps/worker/python/requirements.nvidia.txt`.
