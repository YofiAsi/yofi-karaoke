# Phase 4 — Dokploy smoke checklist

Use after deploying [`docker-compose.yml`](../docker-compose.yml) with HTTPS and domain configured only in Dokploy (for example `yofikaraoke.asafshilo.com`).

1. Open the site over HTTPS. Confirm the home page loads and you can set a display name.
2. As host, confirm host controls appear after playback state syncs.
3. Search and add a song; confirm queue shows **processing** then **ready** within the expected window.
4. Confirm **Socket.IO** behaviour: queue updates and playback ticks appear without the browser opening a direct connection to port 4000 on the public host (path routing should send `/socket.io` to the API).
5. Open the queue drawer; if a row is **failed**, confirm the error text is visible and **Retry** (host only) re-enqueues processing.
6. In Dokploy (or `docker compose ps`), confirm `postgres`, `minio`, `api`, `worker` and `web` all report **healthy**.
7. In the api and worker logs, confirm the `entrypoint: yt-dlp <version>` and `entrypoint: deno <version>` lines. A `yt-dlp update failed` warning is tolerated, but the version line must not say `unavailable`.
8. Redeploy once; confirm Postgres and MinIO volumes keep queue/library data, and that the next song does not download the separation model again (the `karaoke-models` volume keeps it).
9. Redeploy while a song is **processing**; confirm the old worker finishes that song (it may take up to `stop_grace_period`, 6 minutes) instead of leaving it stuck.

When Phase 3 acceptance is also green, tag the release:

```bash
git tag v1.0.0
git push origin v1.0.0
```
