# Karaoke Party App

Self-hosted party karaoke. Phones queue songs → GPU strips vocals → one designated phone plays the instrumental into the speakers while every phone's screen shows synced lyrics + the queue.

## Prerequisites

- Linux host with Intel Arc A750
- Kernel ≥ 6.2 with Arc support (or `intel-i915-dkms`)
- Docker + Docker Compose
- pnpm 9

## Setup

1. Copy `.env.example` to `.env` and fill in your values.
2. Detect your GPU group IDs and add them to `.env`:
   ```bash
   bash scripts/detect-gpu-gids.sh >> .env
   ```
3. Install JS deps (generates `pnpm-lock.yaml`):
   ```bash
   pnpm install
   ```
4. Start the full stack:
   ```bash
   docker compose up -d --build
   ```
   On first boot the `api` container runs `prisma migrate deploy` automatically.

For local (non-Docker) dev, start infra only and run apps on the host:

```bash
bash scripts/dev.sh                        # postgres + minio in Docker
pnpm --filter api prisma migrate deploy
pnpm --filter api dev                      # API on :4000
pnpm --filter worker dev                   # worker (needs yt-dlp + Python/OpenVINO on host)
pnpm --filter web dev                      # Next on :3000, proxies /api and /socket.io to :4000
```

## Phase 1 smoke test

See [`docs/phase-1-smoke-test.md`](docs/phase-1-smoke-test.md) for the end-to-end
acceptance test that proves vocal separation works on the Arc GPU.

## Deployment (Dokploy)

1. Drop `docker-compose.yml` into Dokploy.
2. Configure your domain in the Dokploy UI — do **not** add Traefik labels to the compose file; Dokploy injects them at deploy time.
3. Set environment variables in the Dokploy UI (from `.env.example`).
4. Deploy. Dokploy's Traefik layer routes the public domain to the `web` service on port 3000.

## Architecture

- **web** (Next.js 15, port 3000) — public-facing; proxies `/api/*` and `/socket.io/*` to the `api` service.
- **api** (Fastify 5 + Socket.IO 4, port 4000) — REST + WebSocket (WS lands in Phase 2).
- **worker** (Node + Python + OpenVINO) — job queue via graphile-worker; vocal separation on Intel Arc via ONNX/OpenVINO.
- **postgres** (16) — primary store + graphile-worker queue.
- **minio** — S3-compatible object store for instrumental audio files.

The API also shells out to `yt-dlp` for search and metadata lookups, so the
API image installs `yt-dlp` + Python + ffmpeg alongside Node.

For local (non-Docker) dev of the API you need `yt-dlp` and `ffmpeg` on your PATH.
The worker additionally needs the Intel graphics + OpenVINO stack, which is why
running the worker inside Docker is strongly recommended.
