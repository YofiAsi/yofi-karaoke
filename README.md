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
3. Start local dev dependencies (Postgres + MinIO):
   ```bash
   bash scripts/dev.sh
   ```
4. Apply migrations:
   ```bash
   pnpm --filter api prisma migrate dev
   ```

## Deployment (Dokploy)

1. Drop `docker-compose.yml` into Dokploy.
2. Configure your domain in the Dokploy UI — do **not** add Traefik labels to the compose file; Dokploy injects them at deploy time.
3. Set environment variables in the Dokploy UI (from `.env.example`).
4. Deploy. Dokploy's Traefik layer routes the public domain to the `web` service on port 3000.

## Architecture

- **web** (Next.js 15, port 3000) — public-facing; proxies `/api/*` and `/socket.io/*` to the `api` service.
- **api** (Fastify 5 + Socket.IO 4, port 4000) — REST + WebSocket.
- **worker** (Node + Python + OpenVINO) — job queue via graphile-worker; vocal separation on Intel Arc via ONNX/OpenVINO.
- **postgres** (16) — primary store + graphile-worker queue.
- **minio** — S3-compatible object store for instrumental audio files.
