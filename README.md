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

`docker-compose.yml` is the **production** file (Intel Arc / OpenVINO, locked-down networking — no host port bindings except what Dokploy's Traefik picks up automatically). `docker-compose.nvidia.yml` is for **local dev** on WSL2 + NVIDIA and keeps host ports bound for convenience.

### Routing shape: single domain, path routing

Everything is served under one domain (e.g. `karaoke.example.com`). In the Dokploy UI configure three path routes on the compose app:

| Path          | Target        | Notes                                                                 |
| ------------- | ------------- | --------------------------------------------------------------------- |
| `/socket.io/*` | `api:4000`   | Must be same-origin for cookies. Dokploy's Traefik upgrades to WSS.   |
| `/api/*`      | `api:4000`   | Bypasses the Next.js rewrite at the edge (one hop instead of two).    |
| `/*`          | `web:3000`   | Everything else goes to Next.js.                                      |

### Steps

1. Clone the repo into Dokploy (Git source) and point it at `docker-compose.yml`.
2. Set environment variables in the Dokploy UI (copy from `.env.example`):
   - `HOST_USER_NAME`, `SESSION_SECRET`
   - `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`
   - `NEXT_PUBLIC_WS_URL=https://<your-domain>` — baked into the web image at build time; Socket.IO connects same-origin over WSS.
   - `PUBLIC_ORIGIN=https://<your-domain>` — restricts api CORS + Socket.IO origin in prod.
   - `RENDER_GID`/`VIDEO_GID` if the Dokploy host doesn't use the defaults (109/44). Run `scripts/detect-gpu-gids.sh` on the host.
3. Configure the three path routes above in the Dokploy UI.
4. Deploy. Dokploy injects Traefik labels and the `dokploy-network` at deploy time — do **not** add either to the compose file.

### What's green when

Dokploy shows the stack as healthy once `web`, `api`, `postgres`, and `minio` report `healthy`. The `worker` stays in `running` state — it has no HTTP surface and its liveness is covered by `graphile-worker`'s Postgres heartbeat plus `restart: unless-stopped`.

### Backends

- `docker-compose.yml` — Intel Arc A750 via ONNX + OpenVINO (production).
- `docker-compose.nvidia.yml` — NVIDIA CUDA EP (dev / alt production). Pick one per Dokploy app.

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
