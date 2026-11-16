# Karaoke Party App

Self-hosted party karaoke. Phones queue songs → GPU strips vocals → one designated phone plays the instrumental into the speakers while every phone's screen shows synced lyrics + the queue.

## Prerequisites

**Production (Dokploy):** Linux host with Intel Arc (see `docker-compose.yml`) and Docker. Kernel ≥ 6.2 with Arc support (or `intel-i915-dkms`).

**Local development (NVIDIA / WSL2):** use [`docker-compose.nvidia.yml`](docker-compose.nvidia.yml) instead; see [`bench.md`](bench.md).

- Docker + Docker Compose
- pnpm 9

## Setup

1. Copy `.env.example` to `.env` and fill in your values.
2. Detect your GPU group IDs and add them to `.env`:
   ```bash
   bash scripts/detect-gpu-gids.sh >> .env
   ```
3. Install JS deps:
   ```bash
   pnpm install
   ```
   Commit any `pnpm-lock.yaml` change together with the `package.json` change that caused it. Every image installs with `pnpm install --frozen-lockfile`, so a stale lockfile fails the build.
4. Start the full stack (compose file has **no published ports** — for laptop access, add an override; see below):
   ```bash
   docker compose up -d --build
   ```
   On first boot the `api` container runs `prisma migrate deploy` automatically.

### Local Docker with host ports

The default [`docker-compose.yml`](docker-compose.yml) keeps all services on the internal network only (suitable for Dokploy). To expose Postgres, MinIO, API, and web on localhost:

```bash
cp docker-compose.ports.example.yml docker-compose.override.yml
docker compose up -d --build
```

`docker-compose.override.yml` is gitignored.

For local (non-Docker) dev, start infra only and run apps on the host:

```bash
bash scripts/dev.sh                        # postgres + minio in Docker
pnpm --filter api prisma migrate deploy
pnpm --filter api dev                      # API on :4000
pnpm --filter worker dev                   # worker (needs yt-dlp + Python/OpenVINO on host)
pnpm --filter web dev                      # Next on :3000; set NEXT_PUBLIC_WS_URL=http://127.0.0.1:4000 in .env (Socket.IO cannot upgrade through Next rewrites)
```

## Phase 1 smoke test

See [`docs/phase-1-smoke-test.md`](docs/phase-1-smoke-test.md) for the end-to-end acceptance test that proves vocal separation works on the Arc GPU.

## Deployment (Dokploy)

Production uses **[`docker-compose.yml`](docker-compose.yml)** only (Intel/OpenVINO). **Do not** add Traefik or TLS configuration to the repo — configure the hostname and HTTPS in the **Dokploy UI**; Dokploy’s edge handles certificates.

1. Add the compose project in Dokploy (same `docker-compose.yml`).
2. Set **build arguments** for the `web` image if you change public URLs: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` (defaults are in the compose `build.args`; see `.env.example` comments). Rebuild the web image after changing `NEXT_PUBLIC_*`.
3. Set runtime environment variables in Dokploy (from `.env.example`). `HOST_PIN` and `SESSION_SECRET` are required by the api. `CORS_ORIGIN` is optional and is forwarded only when set. Optional container tuning: `YTDLP_AUTO_UPDATE` (default `true`) and `YTDLP_UPDATE_TIMEOUT_SECONDS` (default `45`), see [Containers](#containers).
4. **Routing Socket.IO:** the browser connects with path `/socket.io`. Next.js rewrites do **not** proxy WebSocket upgrades, so the edge proxy must forward **`/socket.io`** (and typically **`/api`**) on your public hostname to the **`api`** service (`:4000` inside the stack). Forward **`/`** to **`web`** (`:3000`). Example host: `yofikaraoke.asafshilo.com` — TLS is terminated by Dokploy, not by this repository.
5. Deploy. Services are not published on the host; only Dokploy’s routing reaches them.

See [`docs/phase-4-dokploy-smoke.md`](docs/phase-4-dokploy-smoke.md) for a post-deploy smoke checklist.

### Containers

- **yt-dlp freshness:** on every container start the api and worker entrypoint downloads the latest `yt-dlp[default]` into a temp dir, installs it offline into `/opt/venv`, then logs the yt-dlp and Deno versions. Only the download runs under `YTDLP_UPDATE_TIMEOUT_SECONDS`, so a failed or slow download only logs a warning and never removes the version already installed. Set `YTDLP_AUTO_UPDATE=false` to skip it. Restarting the api and worker is enough to pick up a new yt-dlp release; no rebuild is needed.
- **Deno** is installed in the api and worker images because current yt-dlp needs a JavaScript runtime for YouTube.
- **Python:** the worker images run Python 3.11 from `/opt/venv`; `PYTHON_BIN` is set to `/opt/venv/bin/python` in the image.
- **Volumes:** besides Postgres and MinIO data, the worker keeps the separation model (`/app/models`) and its scratch dir (`/tmp/karaoke`) on named volumes, so the model is downloaded once instead of on every deploy.
- **Shutdown:** node receives SIGTERM directly (exec form commands plus `init: true`). The worker has `stop_grace_period: 6m`: on redeploy it stops taking jobs and finishes the song it is processing before the container exits.
- **Health:** the worker is healthy when its node process is running and Postgres answers a query; MinIO is checked with `mc ready local`; api and worker start only after Postgres and MinIO are healthy.

## Vocals stem release (destructive)

The worker now stores two stems per song: `instrumentals/<songId>.mp3` and `vocals/<songId>.mp3`, both encoded once at `STEM_BITRATE` (worker env, default `192k`). yt-dlp extracts the source audio to wav first, so there is only one lossy encode.

**The migration `20261117000000_vocals_and_reset` deletes every song on deploy.** It removes all `Song`, `QueueItem` and `ProcessingJob` rows and resets playback, because songs processed earlier have no vocals stem. It runs automatically with `prisma migrate deploy` when the api container starts, so back up Postgres first if you want to keep the old library.

The migration does not touch MinIO. After the deploy, delete the orphaned stem objects by hand from the api container, first as a dry run:

```bash
docker compose exec api pnpm purge:objects
```

```bash
docker compose exec api pnpm purge:objects --yes
```

Without `--yes` the script is a dry run: it lists the objects under `instrumentals/` and `vocals/` and prints how many are referenced by a `Song` row, how many are newer than one hour, and how many are unreferenced. With `--yes` it deletes only the unreferenced objects older than one hour and prints the deleted and kept counts, so stems of songs processed after the deploy are safe, including one being uploaded right now. Locally the same script is `corepack pnpm --filter api purge:objects --yes` (it reads the root `.env`). Nothing runs it automatically, and it is safe to run again later.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pushes to `main` and on pull requests: frozen lockfile install, `packages/shared` build, Prisma client generation, `tsc --noEmit` for api, web and worker, and the vitest suites of api, web and worker.

## Architecture

- **web** (Next.js 15, port 3000 inside the network) — public entry; server-side rewrites proxy `/api/*` and `/socket.io/*` to `api:4000` for **HTTP** requests from the Next server. Clients use **`NEXT_PUBLIC_WS_URL`** (often `same-origin` in production) so the browser opens WebSocket/WSS against the **public** host; the reverse proxy must forward `/socket.io` to **api**.
- **api** (Fastify 5 + Socket.IO 4, port 4000) — REST + realtime.
- **worker** (Node + Python + OpenVINO in production) — `graphile-worker`; vocal separation on Intel Arc via ONNX/OpenVINO.
- **postgres** (16) — primary store + graphile-worker queue.
- **minio** — S3-compatible object store for the instrumental and vocals stems.

The API shells out to `yt-dlp` for search and metadata lookups, so the API image installs `yt-dlp` + Python + Deno + ffmpeg alongside Node, and refreshes yt-dlp on start.

For local (non-Docker) dev of the API you need `yt-dlp` and `ffmpeg` on your PATH. The worker additionally needs the Intel graphics + OpenVINO stack (or the NVIDIA stack when using `docker-compose.nvidia.yml`), which is why running the worker inside Docker is strongly recommended.
