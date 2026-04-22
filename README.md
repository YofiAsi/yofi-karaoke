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
3. Install JS deps (generates `pnpm-lock.yaml`):
   ```bash
   pnpm install
   ```
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
3. Set runtime environment variables in Dokploy (from `.env.example`).
4. **Routing Socket.IO:** the browser connects with path `/socket.io`. Next.js rewrites do **not** proxy WebSocket upgrades, so the edge proxy must forward **`/socket.io`** (and typically **`/api`**) on your public hostname to the **`api`** service (`:4000` inside the stack). Forward **`/`** to **`web`** (`:3000`). Example host: `yofikaraoke.asafshilo.com` — TLS is terminated by Dokploy, not by this repository.
5. Deploy. Services are not published on the host; only Dokploy’s routing reaches them.

See [`docs/phase-4-dokploy-smoke.md`](docs/phase-4-dokploy-smoke.md) for a post-deploy smoke checklist.

## Architecture

- **web** (Next.js 15, port 3000 inside the network) — public entry; server-side rewrites proxy `/api/*` and `/socket.io/*` to `api:4000` for **HTTP** requests from the Next server. Clients use **`NEXT_PUBLIC_WS_URL`** (often `same-origin` in production) so the browser opens WebSocket/WSS against the **public** host; the reverse proxy must forward `/socket.io` to **api**.
- **api** (Fastify 5 + Socket.IO 4, port 4000) — REST + realtime.
- **worker** (Node + Python + OpenVINO in production) — `graphile-worker`; vocal separation on Intel Arc via ONNX/OpenVINO.
- **postgres** (16) — primary store + graphile-worker queue.
- **minio** — S3-compatible object store for instrumental audio files.

The API shells out to `yt-dlp` for search and metadata lookups, so the API image installs `yt-dlp` + Python + ffmpeg alongside Node.

For local (non-Docker) dev of the API you need `yt-dlp` and `ffmpeg` on your PATH. The worker additionally needs the Intel graphics + OpenVINO stack (or the NVIDIA stack when using `docker-compose.nvidia.yml`), which is why running the worker inside Docker is strongly recommended.
