"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PlaybackStateView } from "@karaoke/shared";

interface PlayerToggleProps {
  currentSongId: string | null;
  playbackState: PlaybackStateView | null;
  isHost: boolean;
  onTick?: (positionSeconds: number) => void;
}

/**
 * HostAudioPlayer — in this app the host is also the player. This component
 * renders the <audio> element on the host device only, keeps it in sync with
 * PlaybackState (play/pause/seek/song switch), and requests a skip when the
 * current song finishes.
 *
 * Browsers block audio.play() until the tab has seen a user gesture; if the
 * initial play is blocked we surface a one-tap unblock button.
 */
export function PlayerToggle({
  currentSongId,
  playbackState,
  isHost,
  onTick,
}: PlayerToggleProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);

  // Claim the player role on mount + 10s heartbeat, release on unmount.
  // The claim keeps PlaybackState.playerUserId in sync so server-side features
  // (e.g. playback:tick routing, stale-takeover) work off a real user id.
  useEffect(() => {
    if (!isHost) return;
    api.post("/api/player/claim").catch(console.error);
    const hb = setInterval(() => {
      api.post("/api/player/heartbeat").catch(console.error);
    }, 10_000);
    return () => {
      clearInterval(hb);
      api.post("/api/player/release").catch(console.error);
    };
  }, [isHost]);

  // Emit 1Hz position while audio is actually playing (for lyric sync in Phase 3).
  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      const el = audioRef.current;
      if (!el || el.paused) return;
      api
        .post("/api/playback/position", { positionSeconds: el.currentTime })
        .catch(console.error);
    }, 1000);
    return () => clearInterval(id);
  }, [isHost]);

  // When the current song changes, load the new src. Play/pause is handled
  // by the isPlaying effect below so we don't double-trigger playback.
  useEffect(() => {
    if (!isHost) return;
    const el = audioRef.current;
    if (!el || !currentSongId) return;
    const nextSrc = `/api/audio/${currentSongId}`;
    if (!el.src.endsWith(nextSrc)) {
      el.src = nextSrc;
    }
  }, [isHost, currentSongId]);

  // Sync play/pause with PlaybackState.isPlaying.
  useEffect(() => {
    if (!isHost) return;
    const el = audioRef.current;
    if (!el || !playbackState) return;
    if (playbackState.isPlaying && el.paused) {
      el.play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    } else if (!playbackState.isPlaying && !el.paused) {
      el.pause();
    }
  }, [isHost, playbackState?.isPlaying, currentSongId]);

  // Sync seek. 1.5s is wider than the 1Hz position POST round-trip so we
  // never fight our own position reports.
  useEffect(() => {
    if (!isHost) return;
    const el = audioRef.current;
    if (!el || !playbackState) return;
    const drift = Math.abs(el.currentTime - playbackState.positionSeconds);
    if (drift > 1.5) {
      el.currentTime = playbackState.positionSeconds;
    }
  }, [isHost, playbackState?.positionSeconds]);

  useEffect(() => {
    if (!isHost || !onTick) return;
    const el = audioRef.current;
    if (!el) return;
    const handler = () => onTick(el.currentTime);
    el.addEventListener("timeupdate", handler);
    return () => el.removeEventListener("timeupdate", handler);
  }, [isHost, onTick]);

  // Audio ended → advance. Host is the player, so we can skip directly.
  useEffect(() => {
    if (!isHost) return;
    const el = audioRef.current;
    if (!el) return;
    async function onEnded() {
      await api.post("/api/playback/skip").catch(console.error);
    }
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [isHost]);

  async function handleUnblock() {
    const el = audioRef.current;
    if (!el) return;
    try {
      await el.play();
      setBlocked(false);
    } catch (err) {
      console.error("audio unblock failed", err);
    }
  }

  if (!isHost) return null;
  if (!currentSongId) return null;

  return (
    <div className="mt-4">
      <audio ref={audioRef} preload="metadata" playsInline />
      {blocked && (
        <button
          onClick={handleUnblock}
          className="w-full rounded-xl bg-white text-black py-4 font-semibold"
        >
          ▶ Tap to start audio
        </button>
      )}
    </div>
  );
}
