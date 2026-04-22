# Phase 3 Smoke Test — Lyrics + Library + Re-queue

> Tasks 3.1–3.7 from `plan.md`. Manual scenarios that verify lyrics sync, library search, and re-queue before Phase 4 begins.

## Setup

```bash
# Bring everything up (NVIDIA path; swap file for Intel/Arc)
docker compose -f docker-compose.nvidia.yml up -d --build

# Confirm API + worker are healthy
curl http://localhost:3000/api/health     # { "ok": true }
docker compose -f docker-compose.nvidia.yml logs worker --tail=10
```

Open the app at `http://<your-machine-ip>:3000`. You need at least **two devices or browser tabs**: one as a regular user, one as the host (`HOST_USER_NAME`).

Have at least one song already in `ready` state with lyrics (check via `docker compose -f docker-compose.nvidia.yml exec postgres psql -U karaoke karaoke -c "SELECT title, \"lyricsLrc\" IS NOT NULL AS has_lyrics FROM \"Song\" LIMIT 5;"`).

---

## Scenario 1 — Lyrics display (song with LRC)

**Goal:** LyricsView renders and scrolls in sync for every connected user.

1. Make sure a song with lyrics is `current` (state `ready` and playing).
2. Open the home page on **Device A** (regular user) and **Device B** (host).
3. **Expected on both devices:** The "Now playing" card shows the lyrics panel below the seek bar. Lines are large, dim — only the active line is white.
4. Host (Device B): tap **Play** if not already playing.
5. Watch both screens for ~10s.
6. **Expected:** The highlighted line advances in sync on both devices as `playback:tick` events arrive (1Hz socket updates).
7. Host: use the seek bar to jump 30s forward.
8. **Expected:** Active line jumps to the correct position within 1–2s on both devices.

**Pass criteria:** Lyrics visible on all devices. Active line matches the audio position. Seek updates the highlight.

---

## Scenario 2 — Player-phone lyrics precision

**Goal:** The host/player phone shows smoother lyric transitions than 1Hz.

1. Host phone: tap **Play here** (becomes player, audio plays locally).
2. Watch the lyric highlight on the **host phone** vs a non-player phone.
3. **Expected:** On the host phone, the active line transitions as soon as the audio crosses the line boundary (driven by `timeupdate`, ~250ms). On other phones, transitions happen at the next 1Hz tick.

**Pass criteria:** No visible stutter on the host phone between line transitions. Non-player phones update within ~1s — acceptable.

---

## Scenario 3 — Song with no lyrics (instrumental)

**Goal:** Graceful fallback when no LRC is available.

1. Find or add a song whose `lyricsLrc` is NULL (check the DB or note that instrumental tracks sometimes have none).
2. Make it `current`.
3. **Expected:** The lyrics panel shows **"Instrumental — no lyrics available."** instead of lines. No error, no empty box.

**Pass criteria:** Fallback message visible. No JS errors in console.

---

## Scenario 4 — Lyric panel absent when queue is empty

**Goal:** LyricsView does not render when nothing is playing.

1. Skip or wait for all songs to finish so the queue is empty.
2. Home page: "Now playing" shows "Queue is empty. Add a song to start."
3. **Expected:** No lyrics panel below it — the section is not rendered at all.

**Pass criteria:** No stale lyrics from the previous song linger on screen.

---

## Scenario 5 — Library search

**Goal:** Library page shows processed songs and filters by title/artist.

1. Navigate: tap **Library** in the top-right header.
2. **Expected:** Library page loads. If songs have been processed, they appear as cards (thumbnail, title, artist · duration). Songs with lyrics show a "Lyrics" badge.
3. Type a partial title in the search box (e.g. first 3 letters of a known song).
4. **Expected:** List filters within 300ms. Non-matching songs disappear.
5. Clear the search box.
6. **Expected:** All processed songs return.

**Pass criteria:** Library shows only songs with `instrumentalObjectKey IS NOT NULL`. Search filters both title and artist case-insensitively.

---

## Scenario 6 — Re-queue from library

**Goal:** Adding a processed song from the library skips the processing step.

1. On the Library page, find a song already in `ready`/`played`/`skipped` state (i.e. not currently active in the queue).
2. Tap **Add** on that song card.
3. **Expected:** Page navigates back to home (`/`). The song appears in "Up next" immediately with state `ready` (no `pending → downloading → …` badge).
4. Play through the current song; the re-queued song starts next.

**Pass criteria:** Re-queued song enters queue as `ready`. No new `ProcessingJob` is created. `POST /api/library/:songId/requeue` returns 201.

---

## Scenario 7 — Re-queue dedupe

**Goal:** Re-queuing a song that is already active in the queue returns 409 and redirects home cleanly.

1. Add a song to the queue from the Library page so it's now in the queue (`ready`/`processing` state).
2. Go back to Library and tap **Add** on the same song again.
3. **Expected:** The app still navigates back to home. No error toast or broken state. The queue has exactly one entry for that song.

**Pass criteria:** 409 response from the API is handled silently. No duplicate queue item.

---

## Scenario 8 — Library "Load more"

**Goal:** Pagination works when the library has more than 20 songs.

> Skip this scenario if the library has fewer than 20 songs.

1. Open Library (no search query).
2. **Expected:** First 20 songs load. A "Load more (N remaining)" button appears at the bottom.
3. Tap **Load more**.
4. **Expected:** Next batch appends below the existing cards. Button updates count or disappears if none remain.

**Pass criteria:** Songs append (not replace) on load-more. Total count stays consistent with the API `total` field.

---

## Scenario 9 — Lyrics switch on song change

**Goal:** Lyrics panel resets correctly when the current song changes.

1. Have two `ready` songs in the queue — Song A (with lyrics) followed by Song B (without, or vice versa).
2. Play Song A. Confirm lyrics appear and highlight.
3. Host: tap **Skip**.
4. **Expected:** Lyrics panel immediately clears and re-renders for Song B. If B has no lyrics, the "Instrumental" message appears. No stale lines from Song A remain.

**Pass criteria:** LRC fetch fires for the new song ID. Old lines never flash on screen between songs.

---

## What is NOT tested here (deferred to Phase 4)

- Word-level lyric highlighting (3.6 stretch — LRCLIB enhanced LRC)
- HTTPS / WSS through Dokploy Traefik
- Wake-lock on the player phone
- Error UX for failed processing (red badge + retry)

## Known limitations (from plan.md)

- iOS Safari will pause `<audio>` when the tab is backgrounded — the player phone must stay foregrounded.
- `playback:tick` position is server-authoritative; if the player phone's clock drifts, non-player phones may lag by up to 1s (acceptable for line-level sync).
- yt-dlp may be rate-limited by YouTube on repeated searches from the same IP.
