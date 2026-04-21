# Phase 1 Smoke Test

> Task 1.21 from `plan.md`. This is the **manual acceptance test** for Phase 1: one user can request a song on localhost and hear the instrumental.

## Prerequisites on the host

- Kernel ≥ 6.2 with Intel Arc support, or `intel-i915-dkms` installed
- Docker + Docker Compose v2
- `pnpm` 9 (for optional dev-outside-Docker)
- A populated `.env` (copy `.env.example`, fill secrets, append GPU GIDs)

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, SESSION_SECRET, HOST_USER_NAME
bash scripts/detect-gpu-gids.sh >> .env
```

## 1. Bring up the stack

```bash
docker compose up -d --build
```

- Expect `postgres`, `minio`, `api`, `web`, `worker` all Healthy after ~1 min.
- Initial build is slow (worker pulls Intel graphics repo + pip installs OpenVINO).

Verify the Arc GPU is visible inside the worker:

```bash
docker compose exec worker clinfo -l
# Must list "Intel(R) Arc(TM) A750 Graphics". If not: STOP.
# Check host /dev/dri, RENDER_GID/VIDEO_GID, and intel-opencl-icd version.
```

API healthcheck:

```bash
curl -sf http://localhost:3000/api/users/me
# 401 unauthenticated is the expected "up and working" response before login.
```

## 2. Single-phone flow (loopback)

On a phone on the same LAN, open `http://<host-lan-ip>:3000/`:

1. Enter a non-host name (e.g. `Alice`). You should land on the home screen with an empty "Up next".
2. Tap "+ Add song". Search for `imagine dragons believer`. Tap "Add" on a result.
3. Home screen: the item appears in "Up next" with state badge `downloading 5%` → `separating 35%` → `fetching_lyrics 80%` → `ready`. Total under ~60s on Arc A750.
4. When the song is `ready`, tap "Play here". Audio plays through the phone speaker (instrumental only — the voice track is gone).
5. Tap "Stop playing here" to pause.

## 3. Second-phone handoff (phase 1 minimum)

Open the same URL on a second phone, enter name `Bob`. Home screen loads with the same now-playing info (polled every 3s in phase 1). No audio plays on Bob's phone until Bob taps "Play here".

Note: phase 1 does not yet coordinate player handoff between phones — both phones could in theory press Play at the same time. The authoritative player-role + lyric sync lands in Phase 2.

## 4. Host-name conflict

Enter the configured `HOST_USER_NAME` (default `YofiAsi`) on phone C. API returns `201` and sets `isHost=true` in the cookie. Try the same name on phone D immediately: expect a `409 host_name_taken` error and a red inline message.

## 5. What Phase 1 explicitly does **not** cover

- No Socket.IO yet; the queue is polled via plain `GET /api/queue` every 3s.
- No lyrics on-screen, no host controls, no synced playback between phones.
- Host takeover after 30s staleness is implemented server-side but there's no heartbeat loop from the client yet.

Those ship in Phase 2 and Phase 3.

## Recording the run

Tail the worker logs so you can paste separation times into `bench.md`:

```bash
docker compose logs --since 10m worker | grep "separate.py wall"
```

If separation is over the 60-second gate, switch `AUDIO_SEP_MODEL` in `.env` to `Kim_Vocal_2.onnx`, restart the worker, and re-run step 2.
