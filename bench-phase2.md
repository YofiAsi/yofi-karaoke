# Phase 2 Smoke Test — Multi-user + Host + Realtime

> Task 2.17 from `plan.md`. No automated gate this time — these are manual scenarios that verify the full multi-device flow before Phase 3 begins.

## Setup

```bash
# Bring everything up (NVIDIA path; swap file for Intel/Arc)
docker compose -f docker-compose.nvidia.yml up -d --build

# Confirm API + worker are healthy
curl http://localhost:3000/api/health     # { "ok": true }
docker compose -f docker-compose.nvidia.yml logs worker --tail=10
```

Open the app at `http://<your-machine-ip>:3000` on multiple devices (or multiple browser tabs if testing solo).

---

## Scenario 1 — Basic realtime queue (single device)

**Goal:** Queue updates live without page refresh.

1. Open the home page. Queue is empty.
2. Tap **+ Add Song** → search for anything → add it.
3. **Expected:** Queue item appears immediately (no refresh). Badge shows `pending → downloading → separating → fetching_lyrics → ready` updating in real time.
4. When ready, the song appears in "Now playing".

**Pass criteria:** No manual refresh needed at any point. Badge steps match the `song:progress` events.

---

## Scenario 2 — Host controls (two devices or tabs)

**Goal:** Only the host sees and can use host controls.

1. **Device A:** Enter any name (e.g. `Alice`). Home page loads normally, no controls visible.
2. **Device B:** Enter the host name (`YofiAsi` or whatever `HOST_USER_NAME` is set to). Home page shows the host control bar (⏮ Prev · ▶ Play · ⏭ Skip + seek bar).
3. **Device A:** Confirm host controls are NOT visible.
4. On Device B, tap **Pause** while a song is ready/playing.
5. **Expected on Device A:** No playback. The now-playing state reflects paused.
6. Tap **Play** on Device B.

**Pass criteria:** Host controls only appear for the host. Pause/play state is visible to all.

---

## Scenario 3 — Player role claim + audio exclusive (two devices/tabs)

**Goal:** Only the phone that claims "Play here" emits audio.

1. Have a song in `ready` state.
2. **Device A:** Tap **Play here**. Audio starts on Device A.
3. **Device B:** Tap **Play here**. 
4. **Expected:** Device A's audio stops automatically (reacts to `player:changed` event). Device B's audio starts. Both devices show the updated "who is playing" state.
5. Device B: tap **Stop playing here** → audio stops, player role released.

**Pass criteria:** Audio is exclusive. Old player stops without manual action when a new player claims.

---

## Scenario 4 — Auto-advance (player is also host)

**Goal:** Song auto-skips when audio ends if the player is the host.

1. **Device B (host):** Tap **Play here**. Device B is now both host and player.
2. Wait for the song to finish (or seek to the end via the seek bar).
3. **Expected:** When `audio.ended` fires, the app POSTs `/api/playback/skip` automatically. If there is a next `ready` song, it becomes current and starts playing.
4. Confirm the queue updates for all connected devices.

**Pass criteria:** No manual skip needed. Next song advances within ~1s of the current one ending.

---

## Scenario 5 — Auto-advance (player is NOT the host)

**Goal:** Server auto-advances after 3s grace if host doesn't skip.

1. **Device A:** Enter `Alice`. Tap **Play here**.
2. **Device B:** Enter host name. Do NOT tap any controls.
3. Wait for the song to end on Device A.
4. **Expected:** Device A emits `playback:ended` to the server. After ~3s (no host action), the server auto-advances. Next `ready` song becomes current.
5. Verify all devices see the queue update.

**Pass criteria:** Auto-advance fires within ~3s of song end. Host inaction is handled gracefully.

---

## Scenario 6 — Skip-if-not-ready

**Goal:** Skip doesn't advance to a song still processing.

1. Add two songs back-to-back quickly (so the second one is still in `processing` state).
2. Play the first song (it should be `ready`).
3. Host taps **Skip**.
4. **Expected:** The second song (still processing) stays in queue as-is. `currentQueueItemId` becomes null (or skips to the first `ready` item after it). No 500 errors.
5. When the second song finishes processing and reaches `ready`, it should be the next up.

**Pass criteria:** Skip never starts a song that isn't `ready`. Processing songs are preserved in the queue.

---

## Scenario 7 — Host stale takeover

**Goal:** A stale host session can be taken over.

1. **Device B:** Enter the host name. Confirm host controls appear.
2. Close Device B's tab (or wait > 30s without a heartbeat).
3. **Device C:** Enter the host name again.
4. **Expected:** Device C becomes the host. `host:changed` event is broadcast. Host controls appear on Device C, not Device B (if B reconnects).

**Pass criteria:** Takeover succeeds after `HOST_STALE_SECONDS`. Old session doesn't block.

---

## Scenario 8 — Player stale reclaim

**Goal:** A stale player role is reclaimable.

1. **Device A:** Tap **Play here** (becomes player).
2. Close Device A's tab (or kill its network) for > 20s.
3. **Device C:** Tap **Play here**.
4. **Expected:** Device C claims the player role without error. `player:changed` is broadcast. Audio starts on Device C.

**Pass criteria:** Player role is reclaimed within `PLAYER_STALE_SECONDS`.

---

## Scenario 9 — Processing progress badge live update

**Goal:** Badge updates in real time during processing.

1. Add a song that isn't cached.
2. Watch the queue item badge on two different devices simultaneously.
3. **Expected:** Both devices show the same step + pct at roughly the same time. Badge goes `pending → downloading → separating → fetching_lyrics → ready` without any refresh.

**Pass criteria:** Both devices stay in sync via `song:progress` socket events.

---

## What is NOT tested here (deferred to Phase 3)

- Lyric sync (`playback:tick` position is wired but LyricsView doesn't exist yet)
- Library page and re-queue flow
- Word-level lyric highlighting

## Known limitations (from plan.md)

- iOS Safari will pause `<audio>` when the tab is backgrounded — the player phone must stay foregrounded.
- Two tabs of the same host name = both think they're host (name-based trust, acceptable for a party).
- yt-dlp may be rate-limited by YouTube on repeated searches from the same IP.
