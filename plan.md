# Karaoke Party App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Execute phases in order. Commit after each task. This plan is dense — every bullet is load-bearing.

**Goal:** Self-hosted party karaoke app. Phones queue songs → GPU strips vocals → one designated phone plays the instrumental into the speakers while every phone's screen shows synced lyrics + the queue. One host controls playback.

**Architecture:** Monorepo (pnpm). TS everywhere. Fastify API + Socket.IO ↔ Next.js UI. `graphile-worker` job queue in Postgres. Python subprocess for vocal separation — two interchangeable GPU backends ship in the repo: Intel Arc A750 via ONNX+OpenVINO (`docker-compose.yml` / `apps/worker/Dockerfile`), or NVIDIA via ONNX+CUDA EP (`docker-compose.nvidia.yml` / `apps/worker/Dockerfile.nvidia`). Selected at compose time via `SEPARATOR_BACKEND`. MinIO for audio. Deployed via Dokploy (Dokploy owns Traefik — do **not** write Traefik labels or reference the dokploy-network in compose; Dokploy injects those at deploy time).

**Tech Stack:** Next.js 15 (App Router), Fastify 5, Socket.IO 4, Prisma 5, Postgres 16, MinIO, graphile-worker, yt-dlp, python-audio-separator (OpenVINO), LRCLIB, Tailwind + shadcn/ui.

---

## 0. Context

Host has a Linux box with a GPU (originally an Intel Arc A750; the repo also ships an NVIDIA CUDA path used for current Phase 1 development on WSL2) and Dokploy. Parties need low-friction song requests from phones, fast (sub-60s) vocal removal, and a shared view — **every participant's phone** must show the currently-playing song, the queue, and synced lyrics. One phone is the "player" (plugged into the speaker, actually emits audio); all other phones stay in lyric-sync via server state. Spec is in the invoking prompt; this plan is the build sequence.

---

## 1. Architecture

```
   Phones (all participants; one of them is the "player")
         |
         +----------- HTTPS --------------+
                        |
              [ Dokploy-managed Traefik ]   (Dokploy owns this layer)
                        |
                   [ web (Next.js) ]     :3000
                        |
          internal ---->|<---- internal
                        |
                   [ api (Fastify+Socket.IO) ]  :4000
                        |                 \
                   [ postgres ]          [ minio ]
                        ^                    ^
                        |                    |
                   [ worker (Node+Python) ]  GPU /dev/dri
                        |
                 yt-dlp, audio-separator, LRCLIB
```

**Player vs. viewer:** every phone's home screen shows now-playing + lyrics + queue. Exactly one phone at a time holds the "player" role — its `<audio>` element plays, and it POSTs its `currentTime` to the server so other phones' lyric highlighting stays in sync. Any phone can claim the player role via a button ("Play here"); claiming takes over from the previous one. Host controls (play/pause/skip/prev/seek) are separate from player role — host can be any phone, including a non-player phone.

**Request flow (add song):**
1. UI POST `/api/search?q=...` → api shells `yt-dlp ytsearch6:...` → 6 filtered results.
2. User picks one → POST `/api/queue` `{ youtubeVideoId }`.
3. api: upsert `songs` row, insert `queue_items` row (`state=processing`), enqueue graphile-worker job `process_song`, broadcast `queue:updated`.
4. Worker pulls job: `download → separate → fetch_lyrics`. After each step: UPDATE `processing_jobs`, emit `song:progress` via Postgres `LISTEN/NOTIFY` → api → Socket.IO.
5. On done: song gets `instrumental_object_key`, queue item → `ready`, broadcast `queue:updated`.
6. Player view auto-advances when current song ends and next `ready` item exists.

---

## 2. Tech Choices (justify each)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15 App Router + TS** | SSR, easy routing for `/`, `/player`, `/library`; huge AI-agent familiarity |
| UI | **Tailwind + shadcn/ui** | zero-runtime, copy-paste components; fast on phone |
| Backend | **Fastify 5 + TS** | faster than Express, first-class plugins, Zod schema support |
| Realtime | **Socket.IO 4** | rooms, reconnection, fallback transports; simpler than raw WS |
| ORM | **Prisma 5** | typed schema, migrations, works cleanly with pg enums |
| Job queue | **graphile-worker** | Postgres-only, TS, `LISTEN/NOTIFY` native, no Redis |
| Vocal sep | **python-audio-separator** w/ ONNX Runtime | MIT, actively maintained. OpenVINO EP for Intel Arc; CUDA EP for NVIDIA. `SEPARATOR_BACKEND` picks the path. |
| Lyrics | **LRCLIB** `GET /api/get` | free, no auth, synced LRC format |
| Object store | **MinIO** | S3 API, self-host, trivial compose |
| YT download | **yt-dlp** | only sane choice; drives both search and download |
| Deploy | **Docker Compose + Traefik labels** | Dokploy-native |
| Runtime pkg mgr | **pnpm + workspaces** | fast, disk-efficient monorepo |

---

## 3. Vocal Separation Decision

**Library:** `python-audio-separator` (pip). Wraps UVR models. Supports CUDA, CoreML, **DirectML, and OpenVINO** as ONNX Runtime EPs.

**Backends shipped:** two interchangeable paths, selected by `SEPARATOR_BACKEND` env.

- `openvino` — ONNX Runtime + OpenVINO EP, device `GPU` (Intel Arc via `intel-opencl-icd` / Level Zero). Primary target of the original plan. Image: `apps/worker/Dockerfile`, compose: `docker-compose.yml`, pip deps: `apps/worker/python/requirements.txt`.
- `cuda` — ONNX Runtime + CUDA EP on `nvidia/cuda:12.6.0-runtime-ubuntu22.04`. Used for current Phase 1 development on WSL2 + NVIDIA. Image: `apps/worker/Dockerfile.nvidia`, compose: `docker-compose.nvidia.yml`, pip deps: `apps/worker/python/requirements.nvidia.txt`.
- `cpu` — last-resort fallback; same image as `openvino`, no GPU mount needed.

**Model:** `UVR-MDX-NET-Inst_HQ_3` (vocals/instrumental split, best quality-to-speed on MDX-Net). Alternative: `Kim_Vocal_2`. Let the implementer benchmark both with a 30s clip during Phase 1 and pin the winner.

**Expected runtime:** ~15–35s for a 4-min song on A750 at chunked inference. (Reference: Arc A750 has comparable ML throughput to an RTX 3060; MDX-Net on 3060 runs ~10–20s/song; OpenVINO EP on Arc is within 1.5–2× that range per community benchmarks in `nomadkaraoke/python-audio-separator` issues and UVR Discord threads.) **Target: <60s.** If the worker exceeds 60s wall-time in Phase 1 benchmarking, fall back to the `HP5_only_main_vocal_LA` model (lighter) before accepting CPU.

**Actual Phase 1 measurement** (NVIDIA path, see `bench.md`): warm run on 4:35 song → separate 15.9s / total pipeline 20.6s. Cold run on 10s clip → separate 42.7s / total 45.8s. Gate met on first candidate model (`UVR-MDX-NET-Inst_HQ_3`), so fallbacks not benchmarked.

**Setup in worker image:**
- Base: `python:3.11-slim` **OR** `node:22-slim` with Python installed. Recommend dual: Node entrypoint that spawns Python. Use multi-stage Dockerfile.
- Apt: `intel-opencl-icd`, `intel-level-zero-gpu`, `level-zero`, `libze1`, `libze-intel-gpu1`, `clinfo` (from Intel's graphics repo; see `https://dgpu-docs.intel.com`).
- Pip: `onnxruntime-openvino`, `openvino==2024.x`, `audio-separator[gpu]` — **pin versions**; unpinned installs break every ~3 months.
- Device mount: `/dev/dri:/dev/dri`, `group_add: ["render","video"]`.
- Verify at container boot: `clinfo -l` must list the Arc GPU; fail fast if not.

**Critical risk:** Intel's consumer Arc + Linux compute stack is fragile. Pin Ubuntu 22.04 base for the Python layer (Intel's repos target it). Document host driver prerequisite (`intel-i915-dkms` or kernel ≥ 6.2 with Arc support).

---

## 4. Trusted OSS Dependencies

| Dep | Repo | Trust |
|---|---|---|
| yt-dlp | github.com/yt-dlp/yt-dlp | Unlicense/public-domain derivative, 80k+ stars, weekly releases, canonical |
| python-audio-separator | github.com/nomadkaraoke/python-audio-separator | MIT, actively maintained 2024–2025, built on UVR models |
| ONNX Runtime | github.com/microsoft/onnxruntime | MIT, Microsoft, first-class OpenVINO EP |
| OpenVINO | github.com/openvinotoolkit/openvino | Apache-2.0, Intel, official Arc support |
| LRCLIB | github.com/tranxuanthang/lrclib | MIT, public API lrclib.net, synced LRC source of record |
| Next.js | github.com/vercel/next.js | MIT, Vercel, 125k+ stars |
| Fastify | github.com/fastify/fastify | MIT, OpenJS Foundation, 32k+ stars |
| Socket.IO | github.com/socketio/socket.io | MIT, 61k+ stars, maintained |
| Prisma | github.com/prisma/prisma | Apache-2.0, 40k+ stars |
| graphile-worker | github.com/graphile/worker | MIT, Benjie Gillam (Postgraphile), mature Postgres-only queue |
| MinIO | github.com/minio/minio | AGPL-3.0 (server; fine for self-host), 48k+ stars |
| shadcn/ui | github.com/shadcn-ui/ui | MIT, copy-in components, 75k+ stars |

**License note:** MinIO is AGPL — fine for self-hosting; do **not** redistribute a modified fork without source. Flag to user only if they ever plan to SaaS-ify this.

---

## 5. Data Model (Prisma schema, authoritative)

```prisma
// apps/api/prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id            String   @id @default(uuid()) @db.Uuid
  name          String   @unique
  isHost        Boolean  @default(false)
  lastSeenAt    DateTime @default(now())
  createdAt     DateTime @default(now())
  queueItems    QueueItem[]
  @@index([name])
}

model Song {
  id                    String   @id @default(uuid()) @db.Uuid
  youtubeVideoId        String   @unique
  title                 String
  artist                String
  channel               String
  durationSeconds       Int
  thumbnailUrl          String
  instrumentalObjectKey String?  // MinIO key; null until ready
  originalObjectKey     String?  // optional: keep original for rebake
  lyricsLrc             String?  @db.Text
  lyricsSource          String?  // "lrclib" | "none"
  createdAt             DateTime @default(now())
  queueItems            QueueItem[]
  processingJobs        ProcessingJob[]
  @@index([title])
  @@index([artist])
}

enum QueueState { queued processing ready played skipped failed }

model QueueItem {
  id                 String     @id @default(uuid()) @db.Uuid
  songId             String     @db.Uuid
  song               Song       @relation(fields: [songId], references: [id])
  requestedByUserId  String     @db.Uuid
  requestedByUser    User       @relation(fields: [requestedByUserId], references: [id])
  position           Int        // monotonically increasing; sort asc
  state              QueueState @default(queued)
  createdAt          DateTime   @default(now())
  playedAt           DateTime?
  @@index([state, position])
}

enum ProcessingStep { pending downloading separating fetching_lyrics done error }

model ProcessingJob {
  id             String         @id @default(uuid()) @db.Uuid
  songId         String         @db.Uuid
  song           Song           @relation(fields: [songId], references: [id])
  step           ProcessingStep @default(pending)
  progressPct    Int            @default(0)
  errorMessage   String?        @db.Text
  startedAt      DateTime?
  completedAt    DateTime?
  @@index([songId])
}

model PlaybackState {
  id                    Int      @id @default(1)   // singleton: CHECK (id = 1)
  currentQueueItemId    String?  @db.Uuid
  positionSeconds       Float    @default(0)
  isPlaying             Boolean  @default(false)
  hostUserId            String?  @db.Uuid
  hostLastHeartbeatAt   DateTime?
  playerUserId          String?  @db.Uuid      // which phone is emitting audio
  playerLastHeartbeatAt DateTime?
  updatedAt             DateTime @updatedAt
}
```

Add raw SQL migration: `ALTER TABLE "PlaybackState" ADD CONSTRAINT singleton CHECK (id = 1);` and seed one row.

---

## 6. API Surface

### REST (all JSON; `x-user-id` cookie drives identity)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/api/users` | `{ name }` | `{ id, name, isHost }` or `409` if host-name-taken-and-fresh |
| POST | `/api/users/heartbeat` | — | `204`; updates `lastSeenAt` (and `hostLastHeartbeatAt` if host) |
| GET | `/api/search` | `?q=` | `[{ youtubeVideoId, title, channel, durationSeconds, thumbnailUrl }]` (≤6, filtered) |
| POST | `/api/queue` | `{ youtubeVideoId }` | `{ queueItemId, songId, state }` |
| GET | `/api/queue` | — | `{ current, upcoming[] }` with song + requester + state |
| GET | `/api/library` | `?q=&limit=&offset=` | `{ items: Song[], total }` |
| POST | `/api/library/:songId/requeue` | — | same as POST `/api/queue` but skips processing if `instrumentalObjectKey` set |
| POST | `/api/playback/play` | — | `204` (host-only) |
| POST | `/api/playback/pause` | — | `204` (host-only) |
| POST | `/api/playback/skip` | — | `204` (host-only) |
| POST | `/api/playback/previous` | — | `204` (host-only) |
| POST | `/api/playback/seek` | `{ positionSeconds }` | `204` (host-only) |
| POST | `/api/playback/position` | `{ positionSeconds }` | `204` (player-only; sent every ~1s by the active player phone) |
| POST | `/api/player/claim` | — | `{ playerUserId }`; takes over player role |
| POST | `/api/player/release` | — | `204`; clears player role if caller holds it |
| POST | `/api/player/heartbeat` | — | `204`; called every 10s by active player |
| GET | `/api/audio/:songId` | Range supported | `audio/mpeg` or `audio/opus` streamed from MinIO |

**Host-only middleware:** checks `req.user.isHost === true` AND `playbackState.hostUserId === req.user.id`. 403 otherwise.

### Socket.IO events (server → client)

| Event | Payload |
|---|---|
| `queue:updated` | `{ current, upcoming[] }` (same shape as GET) |
| `song:progress` | `{ songId, step, progressPct, errorMessage? }` |
| `playback:state` | `{ currentQueueItemId, positionSeconds, isPlaying, hostUserId, playerUserId }` |
| `playback:tick` | `{ positionSeconds }` (high-frequency, ~1Hz, from active player → all clients for lyric sync) |
| `host:changed` | `{ hostUserId, hostUserName }` |
| `player:changed` | `{ playerUserId, playerUserName }` |

### Socket.IO events (client → server, host-only; alt to REST)
`playback:play`, `playback:pause`, `playback:skip`, `playback:previous`, `playback:seek { positionSeconds }` — REST is authoritative; these are optimistic.

### Host contention rules
- POST `/api/users` with `name === HOST_USER_NAME`:
  - If no existing host user OR `hostLastHeartbeatAt` older than `HOST_STALE_SECONDS` (default 30): take over. Set `isHost=true`, set `PlaybackState.hostUserId`, emit `host:changed`.
  - Else: `409 { error: "host_name_taken" }`.
- Heartbeat every 10s from host browser.

---

## 7. docker-compose.yml outline

> **No Traefik labels. No `dokploy-network`.** Dokploy injects both at deploy time. The compose file describes only the app's services, internal network, volumes, env, and GPU mounts.

```yaml
services:
  web:
    image: karaoke-web
    build: { context: ., dockerfile: apps/web/Dockerfile }
    environment:
      - NEXT_PUBLIC_API_URL=/api
      - NEXT_PUBLIC_WS_URL=/socket.io
    depends_on: [api]
    # The Next.js server proxies /api/* and /socket.io/* to the api service
    # so Dokploy only needs to route the public domain to this single port.
    ports:
      - "3000"

  api:
    image: karaoke-api
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      - DATABASE_URL=postgres://karaoke:${POSTGRES_PASSWORD}@postgres:5432/karaoke
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
      - MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
      - MINIO_BUCKET=${MINIO_BUCKET}
      - HOST_USER_NAME=${HOST_USER_NAME}
      - HOST_STALE_SECONDS=30
      - PLAYER_STALE_SECONDS=20
      - SESSION_SECRET=${SESSION_SECRET}
    depends_on: [postgres, minio]

  worker:
    image: karaoke-worker
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    environment:
      - DATABASE_URL=postgres://karaoke:${POSTGRES_PASSWORD}@postgres:5432/karaoke
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
      - MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
      - MINIO_BUCKET=${MINIO_BUCKET}
      - AUDIO_SEP_MODEL=UVR-MDX-NET-Inst_HQ_3
      - OV_DEVICE=GPU
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "${RENDER_GID:-109}"
      - "${VIDEO_GID:-44}"
    depends_on: [postgres, minio, api]

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=karaoke
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=karaoke
    volumes: [pgdata:/var/lib/postgresql/data]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      - MINIO_ROOT_USER=${MINIO_ROOT_USER}
      - MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
    volumes: [miniodata:/data]

volumes:
  pgdata:
  miniodata:
```

**Traffic routing (no labels):** Next.js is the only public service. Configure `next.config.ts` with `rewrites()` so `/api/*` → `http://api:4000/*` and `/socket.io/*` → `http://api:4000/socket.io/*` (and `ws: true` on the rewrite). Dokploy's Traefik layer only needs the `web` service reachable on port 3000; everything else stays on the default compose network Dokploy creates.

**GPU GIDs:** `render`/`video` GIDs differ per host. `.env` takes `RENDER_GID` and `VIDEO_GID` (defaults 109 / 44). `scripts/detect-gpu-gids.sh` greps `getent group render video` and emits an env fragment. Document in README.

---

## 8. Repo Layout

```
karaoke/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json                 # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── scripts/
│   ├── detect-gpu-gids.sh
│   └── dev.sh                   # boots postgres+minio for local dev
├── packages/
│   └── shared/                  # zod schemas, types shared by web+api
│       ├── package.json
│       └── src/{index.ts,schemas.ts,events.ts}
└── apps/
    ├── web/                     # Next.js 15
    │   ├── Dockerfile
    │   ├── next.config.ts       # rewrites /api → http://api:4000, /socket.io → ws://api:4000
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx         # home: now-playing + lyrics + queue + add button
    │   │   ├── name/page.tsx    # first-visit name entry
    │   │   ├── search/page.tsx  # add-song flow
    │   │   └── library/page.tsx
    │   ├── components/
    │   │   ├── NowPlaying.tsx         # title, artist, requester, progress bar (everyone sees)
    │   │   ├── LyricsView.tsx         # LRC parser + active-line highlight (everyone sees)
    │   │   ├── QueueList.tsx
    │   │   ├── AddSongButton.tsx
    │   │   ├── SearchResults.tsx
    │   │   ├── ProcessingBadge.tsx
    │   │   ├── HostControls.tsx       # play/pause/skip/prev/seek (host-only)
    │   │   └── PlayerToggle.tsx       # "Play here" / "Stop playing here" (any phone)
    │   └── lib/{socket.ts,user.ts,api.ts,lrc.ts,audio.ts}
    ├── api/
    │   ├── Dockerfile
    │   ├── prisma/schema.prisma
    │   ├── src/
    │   │   ├── index.ts                # fastify + socket.io bootstrap
    │   │   ├── env.ts                  # zod-parsed env
    │   │   ├── db.ts
    │   │   ├── minio.ts
    │   │   ├── auth/userCookie.ts
    │   │   ├── host/hostService.ts     # takeover + heartbeat
    │   │   ├── routes/
    │   │   │   ├── users.ts
    │   │   │   ├── search.ts           # ytdlp search
    │   │   │   ├── queue.ts
    │   │   │   ├── library.ts
    │   │   │   ├── playback.ts
    │   │   │   └── audio.ts            # ranged streaming from minio
    │   │   ├── sockets/
    │   │   │   ├── index.ts
    │   │   │   └── broadcast.ts        # LISTEN/NOTIFY bridge
    │   │   └── jobs/enqueueProcessSong.ts
    └── worker/
        ├── Dockerfile                  # multi-stage: node + python + openvino
        ├── src/
        │   ├── index.ts                # graphile-worker runner
        │   ├── tasks/processSong.ts    # orchestrates 3 steps, emits NOTIFY
        │   ├── steps/download.ts       # yt-dlp subprocess
        │   ├── steps/separate.ts       # spawns python separate.py
        │   ├── steps/lyrics.ts         # LRCLIB fetch
        │   └── minioUpload.ts
        └── python/
            ├── requirements.txt        # pinned
            └── separate.py             # thin CLI wrapper around audio-separator
```

---

## 9. Phased Build Plan

> TDD where reasonable (pure logic: LRC parser, host takeover logic, queue position math). Integration flows (yt-dlp, separator) use smoke tests, not unit tests — mocking them is a lie.

### Phase 0 — Bootstrap (1 commit per step) — DONE

- [x] **0.1** `git init` in `/root/repos/karaoke`. Add `.gitignore` (`node_modules/`, `dist/`, `.next/`, `.env`, `*.log`, `apps/worker/python/__pycache__`, `models/`).
- [x] **0.2** Write root `package.json` with `"packageManager": "pnpm@9"`, `pnpm-workspace.yaml` listing `apps/*` and `packages/*`, `tsconfig.base.json` with `strict: true`.
- [x] **0.3** Write `.env.example` listing every var (see §10).
- [x] **0.4** Write `docker-compose.yml` per §7. Write empty placeholder Dockerfiles.
- [x] **0.5** Commit: `chore: bootstrap monorepo and compose skeleton`.

### Phase 1 — Single-user local loop (prove the hard part works) — DONE

Ship order: DB → worker vocal sep → api minimal → web minimal. At end of phase: **one user can request a song on localhost and hear the instrumental**.

- [x] **1.1 Prisma schema** (`apps/api/prisma/schema.prisma`) per §5. Run `pnpm prisma migrate dev --name init`. Add singleton CHECK. Seed one PlaybackState row.
- [x] **1.2 Worker Dockerfile** — multi-stage:
  - Stage A: `node:22-bookworm-slim`, install pnpm, build worker TS.
  - Stage B: `ubuntu:22.04`, add Intel graphics repo, install `intel-opencl-icd intel-level-zero-gpu level-zero libze1 clinfo python3.11 python3-pip ffmpeg`, copy node + compiled worker, pip install from `requirements.txt`.
  - Entrypoint: `clinfo -l` sanity check → `node dist/index.js`.
  - _Also shipped:_ `apps/worker/Dockerfile.nvidia` + `docker-compose.nvidia.yml` for the CUDA path (`nvidia/cuda:12.6.0-runtime-ubuntu22.04`, `nvidia-smi` sanity check instead of `clinfo`).
- [x] **1.3 Pin** `requirements.txt`: OpenVINO triplet pinned in `apps/worker/python/requirements.txt`; CUDA triplet pinned in `apps/worker/python/requirements.nvidia.txt`.
- [x] **1.4 `python/separate.py`** — argparse + `SEPARATOR_BACKEND` branch (`openvino` / `cuda` / `cpu`). Prints the instrumental output path to stdout. Fails fast if the requested GPU isn't detected.
- [x] **1.5 Worker: `steps/download.ts`** — spawns `yt-dlp -f bestaudio -x --audio-format mp3 …`.
- [x] **1.6 Worker: `steps/separate.ts`** — spawns `python3 separate.py`, parses stdout for instrumental path, hard timeout on step; logs `separate.py wall=<ms>ms` for bench.
- [x] **1.7 Worker: `steps/lyrics.ts`** — GET `https://lrclib.net/api/get?…`.
- [x] **1.8 Worker: `minioUpload.ts`** — `@aws-sdk/client-s3` against MinIO. Key: `instrumentals/<songId>.mp3`.
- [x] **1.9 Worker: `tasks/processSong.ts`** — orchestrates download→separate→lyrics→upload, updates `ProcessingJob`, emits `NOTIFY song_progress` and `NOTIFY queue_updated` for the Phase 2 Socket.IO bridge to pick up.
- [x] **1.10 Worker: `index.ts`** — `graphile-worker` `run` with `taskList: { process_song }`, `concurrency: 1`.
- [x] **1.11 Benchmark** — **gate met.** See `bench.md`: `UVR-MDX-NET-Inst_HQ_3` on NVIDIA (CUDA EP), 4:35 song → separate 15.9s / total 20.6s (warm); 10s clip → separate 42.7s / total 45.8s (cold, model load).
- [x] **1.12 API: `index.ts`** Fastify + cors + cookie + zod provider. Error handler coerces unhandled errors to 500 (see deferred item below).
- [x] **1.13 API: `routes/users.ts`** — POST create, cookie `karaoke_uid` (httpOnly=false, SameSite=Lax), host-name logic via `hostService.ts`.
- [x] **1.14 API: `routes/search.ts`** — `yt-dlp --dump-single-json --flat-playlist ytsearch10:…`, filtered to `duration < 600 && !is_live`, top 6.
- [x] **1.15 API: `routes/queue.ts`** — POST upserts Song, inserts QueueItem, enqueues `process_song`; GET returns `{ current, upcoming[] }`.
- [x] **1.16 API: `routes/audio.ts`** — range-aware stream from MinIO (`Accept-Ranges: bytes`, 206 partial).
- [x] **1.17 Web: `app/name/page.tsx`** — form → `POST /api/users` → localStorage shadow → redirect home.
- [x] **1.18 Web: `app/page.tsx`** — now-playing panel, polled queue (3s `setInterval`; will be replaced by Socket.IO in 2.8), "Play here" toggle + hidden `<audio>`.
- [x] **1.19 Web: `app/search/page.tsx`** — debounced search + add-to-queue.
- [x] **1.20 Web: `lib/audio.ts`** — `AudioController` wrapper: `play/pause/seek` + `onTimeUpdate/onEnded/onPlay/onPause/onError`.
- [x] **1.21 Smoke test local** — user-verified: single-user flow plays the instrumental end-to-end; two-phone takeover / auto-advance are intentionally deferred (see Phase 2).

**Phase 1 deferred items (carried into Phase 2 or later):**

- Exclusive playback between browsers/phones — handled by Phase 2.5 (`playerService`) + 2.13 (`PlayerToggle` reacting to `player:changed`). Today both tabs play simultaneously.
- Auto-advance on `ended` — handled by Phase 2.15 (`POST /api/playback/skip`, `state=played`, pick next `ready`).
- yt-dlp "video unavailable" returns `500` — cosmetic. Should become `422 video_unavailable` with a UI message. Fold into Phase 3 queue/library polish or Phase 4 error UX (4.6).
- Stale cookie after `docker compose down -v` — client trusts localStorage, so the user isn't bounced to `/name`. Low-priority dev ergonomics fix: on page load `GET /api/users/me`, clear localStorage + redirect on 401. Not a gate.

### Phase 2 — Multi-user + host + realtime

- [ ] **2.1 Socket.IO server** (`api/src/sockets/index.ts`) — attach to fastify's HTTP server. Auth via `karaoke_uid` cookie.
- [ ] **2.2 Postgres LISTEN bridge** (`sockets/broadcast.ts`) — dedicated pg client LISTENs on `queue_updated`, `song_progress`, `playback_state`, `host_changed`, `player_changed`. On notify: `io.emit(channel, payload)`.
- [ ] **2.3 API triggers** — after each mutation (queue insert/update, playback state write, host change, player change), issue `NOTIFY` from the same tx.
- [ ] **2.4 Host service** (`host/hostService.ts`) — takeover rules + heartbeat; unit tests for stale-takeover and conflict paths.
- [ ] **2.5 Player service** (`player/playerService.ts`) — claim/release/heartbeat; `PLAYER_STALE_SECONDS` takeover rule (same pattern as host).
- [ ] **2.6 Playback routes** (`routes/playback.ts`) — mutate PlaybackState; host-only middleware. `/api/playback/position` restricted to the current `playerUserId`.
- [ ] **2.7 Web: `lib/socket.ts`** — singleton client, auto-reconnect, typed events.
- [ ] **2.8 Web live queue** — swap fetch for subscribe-to-`queue:updated` with initial fetch.
- [ ] **2.9 Web now-playing** — subscribe to `playback:state`; render `NowPlaying.tsx` on home for **every user** (not host-gated, not player-gated).
- [ ] **2.10 Web processing progress** — subscribe to `song:progress`, show step + pct in badge on queue item.
- [ ] **2.11 Web host controls** — `HostControls.tsx` visible on home **iff** `user.isHost && playbackState.hostUserId === user.id`. Play/Pause/Skip/Prev/Seek.
- [ ] **2.12 Web host heartbeat** — 10s interval POST `/api/users/heartbeat` while host tab open.
- [ ] **2.13 Web player toggle** — `PlayerToggle.tsx`: "Play here" claims the player role (POST `/api/player/claim`), starts the local `<audio>`, begins 10s heartbeat + 1s `/api/playback/position` POSTs. "Stop playing here" releases. If another phone claims, this phone's audio pauses (react to `player:changed`).
- [ ] **2.14 Lyric-sync channel** — active player emits `playback:tick` (1Hz) via Socket.IO; all clients use it to drive lyric highlight. Non-player phones don't run `<audio>` — they just track the tick.
- [ ] **2.15 Auto-advance** — when player's `<audio>` `ended` fires AND the local user is also host: POST `/api/playback/skip`. If player ≠ host, the player emits `playback:ended` and server waits for host skip (or auto-advances after a 3s grace if no host).
- [ ] **2.16 Skip-if-not-ready** — server: on skip, pick next QueueItem with `state=ready`. Items not yet ready stay in queue; they become playable once processing finishes.
- [ ] **2.17 Commit.** Smoke test with three phones: one host, one player, one plain participant — all three see now-playing + queue; only host sees controls; only player emits audio.

### Phase 3 — Lyrics + library + re-queue

- [ ] **3.1 Library route** (`routes/library.ts`) — paginated search over Songs with `instrumentalObjectKey IS NOT NULL`. ILIKE on title + artist.
- [ ] **3.2 Re-queue route** (`library/:songId/requeue`) — insert QueueItem `state=ready` directly if already processed; no job enqueued. Assert dedupe.
- [ ] **3.3 Dedupe enforcement** — `/api/queue` POST: if Song exists with `instrumentalObjectKey` → QueueItem `state=ready`, no job. If Song exists mid-processing → QueueItem attached to in-flight job; do not enqueue a duplicate.
- [ ] **3.4 LRC parser** (`web/lib/lrc.ts`) — parse `[mm:ss.xx]` lines to `[{ time, text }]`. Unit tests.
- [ ] **3.5 LyricsView** — shown on home for **every user**. Input: the `playback:tick` position from Socket.IO (authoritative on non-player phones) OR the local `<audio>` `currentTime` on the player phone. Highlights the active line; smooth scroll; large font readable on a phone. If no LRC: show "Instrumental — no lyrics available."
- [ ] **3.6 Word-level highlight (stretch)** — LRCLIB sometimes returns enhanced LRC (`<mm:ss.xx>`). Detect and split words; fall back to line-only. Ship line-only first; word is optional polish.
- [ ] **3.7 Library page UI** — search box, grid of song cards, "Add to queue" button per card.
- [ ] **3.8 Commit.**

### Phase 4 — Polish + Dokploy

- [ ] **4.1 Next.js rewrites** — `next.config.ts` proxies `/api/*` and `/socket.io/*` (with `ws: true`) to `http://api:4000`. Verified locally via `docker compose up`.
- [ ] **4.2 HTTPS via Dokploy** — no Traefik labels in compose; configure the domain in the Dokploy UI and let Dokploy issue certs. Ensure Socket.IO upgrades over WSS work through Dokploy's Traefik.
- [ ] **4.3 `.env.example`** finalized; document each var.
- [ ] **4.4 README** — prerequisites (Arc driver, GID detection script), local dev, Dokploy deploy steps (emphasize: do **not** add Traefik labels — Dokploy owns that).
- [ ] **4.5 Healthchecks** — api `GET /health`, worker exposes `graphile-worker` status, compose `healthcheck` directives.
- [ ] **4.6 Error UX** — processing failures show red badge + retry button on queue item.
- [ ] **4.7 Mobile polish** — sticky "Add a Song" button, large tap targets, safe-area insets, lyric text sized for phone reading distance, auto-scroll follows active line.
- [ ] **4.8 Player-phone polish** — when "Play here" is active: wake-lock (`navigator.wakeLock.request('screen')`) so the phone doesn't sleep mid-song; warn if user backgrounds the tab (iOS Safari will pause audio).
- [ ] **4.9 Deploy to Dokploy** — drop compose in, configure domain in the UI, deploy, smoke test end-to-end.
- [ ] **4.10 Tag v1.0.**

---

## 10. `.env.example`

```dotenv
# Host + player role
HOST_USER_NAME=YofiAsi
HOST_STALE_SECONDS=30
PLAYER_STALE_SECONDS=20
SESSION_SECRET=change-me-long-random

# Note: DOMAIN / TLS are configured in the Dokploy UI, not here.

# Postgres
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgres://karaoke:change-me@postgres:5432/karaoke

# MinIO
MINIO_ROOT_USER=karaoke
MINIO_ROOT_PASSWORD=change-me-long
MINIO_BUCKET=karaoke

# Worker / GPU
AUDIO_SEP_MODEL=UVR-MDX-NET-Inst_HQ_3.onnx
# openvino = Intel Arc (docker-compose.yml)
# cuda     = NVIDIA GPU (docker-compose.nvidia.yml)
# cpu      = fallback, no GPU
SEPARATOR_BACKEND=openvino
# Intel Arc only — override if host uses non-default GIDs for render/video:
# RENDER_GID=109
# VIDEO_GID=44
```

---

## 11. Verification

End-to-end manual test (must pass before declaring v1):

1. `docker compose up -d`. `docker compose logs worker | grep "GPU"` shows Arc detected.
2. On phone A (LAN): open site → enter name "Alice" → add song → queue shows Alice's entry processing → within ~60s goes `ready`.
3. On phone B: enter name `YofiAsi` → becomes host → sees controls. Host controls visible on **home**, no separate TV route.
4. On phone C (plugged into the speaker): tap "Play here" → audio emits from phone C only; home page of **every** phone (A, B, C) shows now-playing info + synced lyrics highlighting in lockstep.
5. On phone A: "Play here" → takes over from C; C's audio pauses; A's audio starts; lyric sync continues seamlessly for everyone.
6. Host (B) taps Skip → next ready song plays on the current player phone; processing song stays in queue if not ready.
7. Library page shows both songs; re-queueing from library skips processing.
8. Phone D tries to enter name `YofiAsi` → gets conflict error.
9. Host phone B closes tab for >30s; phone D re-tries `YofiAsi` → takes over; `host:changed` broadcast.
10. Active player phone closes tab for >20s → `player_changed` emitted with null; any phone's "Play here" claims it.
11. Redeploy via Dokploy → volumes survive, queue/library intact; Dokploy's Traefik layer continues to serve the app without any compose labels.

Unit tests required (CI):
- `lib/lrc.ts` parser
- `host/hostService.ts` takeover logic
- queue dedupe / position math

---

## 12. Risks & Open Questions (flag to user before coding)

1. **Arc driver fragility.** Intel's compute stack on Linux has version-coupling landmines. The host must run kernel ≥ 6.2 and Intel's `intel-opencl-icd` ≥ 24.x. If the host is on an older kernel, this blocks the OpenVINO path — the NVIDIA CUDA path (`docker-compose.nvidia.yml`) is a supported alternative and is what Phase 1 was benchmarked on (WSL2 + CUDA 12.6 runtime).
2. **OpenVINO EP vs DirectML.** On Linux Arc, OpenVINO is the right call. On Windows Arc, DirectML is faster. Plan assumes Linux; confirm.
3. **yt-dlp search ratelimits.** YouTube has begun aggressive IP blocks. Plan uses `yt-dlp` directly; if blocked, fallback is `yt-dlp --cookies-from-browser` or rotating proxies — **not shipped**. Flag as known limitation.
4. **MinIO AGPL.** Fine for self-host; not fine for redistribution. Confirm user's use is self-host only.
5. **Lyrics word-level sync.** LRCLIB enhanced LRC coverage is patchy; ship line-level first.
6. **Singleton PlaybackState.** Spec says "one user at a time controls". We enforce host by *name*, not by locking. Two tabs of the same host name = both control. Acceptable given name-based trust model.
7. **Spec-flag: host by env-var name is weak trust.** Anyone on the LAN who learns the name becomes host. This is **fine for a party** but document it. Optional hardening: add a `HOST_PASSCODE` env-var checked on host claim. Propose to user; default off to honor simple spec.
8. **Spec-flag: "previous" on a streaming karaoke queue.** Semantics unclear — rewind current song, or pop back to last `played` QueueItem? Plan implements **"re-play the last `played` item"**. Confirm.
9. **Reverse proxy.** Plan uses Next.js `rewrites()` (`/api/*` and `/socket.io/*` → internal `api` service) so Dokploy only needs to route one public port. No Traefik labels in compose, no second subdomain — Dokploy handles the outer TLS/routing. Simpler CORS and cookies.
10. **Spec-flag: spec mentioned `graphile-worker` or `pg-boss`.** Plan picks `graphile-worker` — better TS ergonomics and `LISTEN/NOTIFY` fit. `pg-boss` is also fine; not a blocker.
11. **Mobile audio quirks.** iOS Safari auto-pauses `<audio>` when the tab is backgrounded — the "player" phone must stay foregrounded with the screen awake. Plan uses the Screen Wake Lock API in Phase 4 as mitigation; still not perfect. If this bites, fallback is to require the player to be a desktop browser (but user prefers phone — accept the constraint).
12. **Lyric-sync precision.** 1Hz ticks give ~500ms worst-case lyric lag on non-player phones. Good enough for line-level karaoke; not good enough for word-level. If word-level sync is important across phones, bump tick to 4Hz and use dead-reckoning (client extrapolates between ticks using its own clock + last `isPlaying` state).

---

## 13. Git bootstrap (first shell commands after plan approval)

```bash
cd /root/repos/karaoke
git init -b main
# write .gitignore, package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example, docker-compose.yml, README.md stub
git add -A
git commit -m "chore: bootstrap monorepo and compose skeleton"
```
