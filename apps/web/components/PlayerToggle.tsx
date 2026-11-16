"use client";

// Player role: the host device claims the player, and only the player device renders <audio>.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlaybackStateView } from "@karaoke/shared";
import { api } from "@/lib/api";

interface PlayerToggleProps {
  isHost: boolean;
  isPlayer: boolean;
  audioSongId: string | null;
  playbackState: PlaybackStateView | null;
  onTick?: (positionSeconds: number) => void;
}

const HEARTBEAT_MS = 10_000;
const POSITION_REPORT_MS = 1000;
const SEEK_TOLERANCE_SECONDS = 1.5;

function audioUrl(songId: string): string {
  return `/api/audio/${songId}`;
}

function loadSource(el: HTMLAudioElement, songId: string | null): void {
  if (!songId) {
    if (el.hasAttribute("src")) {
      el.removeAttribute("src");
      el.load();
    }
    return;
  }
  if (!el.src.endsWith(audioUrl(songId))) el.src = audioUrl(songId);
}

function usePlayerClaim(isHost: boolean): void {
  useEffect(() => {
    if (!isHost) return;
    api.post("/api/player/claim").catch(console.error);
    const id = setInterval(() => {
      api.post("/api/player/heartbeat").catch(console.error);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      api.post("/api/player/release").catch(console.error);
    };
  }, [isHost]);
}

function useWakeLock() {
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const release = useCallback(() => {
    const lock = wakeRef.current;
    wakeRef.current = null;
    void lock?.release();
  }, []);

  const acquire = useCallback(async () => {
    if (!("wakeLock" in navigator) || !navigator.wakeLock) return;
    try {
      release();
      const lock = await navigator.wakeLock.request("screen");
      wakeRef.current = lock;
      lock.addEventListener("release", () => {
        if (wakeRef.current === lock) wakeRef.current = null;
      });
    } catch {
      wakeRef.current = null;
    }
  }, [release]);

  useEffect(() => release, [release]);

  return { acquire, release };
}

function useVisibilityWatch(audioRef: RefObject<HTMLAudioElement | null>, onVisiblePlaying: () => void) {
  const [hiddenWhilePlaying, setHiddenWhilePlaying] = useState(false);

  useEffect(() => {
    function onVisibilityChange() {
      const playing = !!audioRef.current && !audioRef.current.paused;
      setHiddenWhilePlaying(document.hidden && playing);
      if (!document.hidden && playing) onVisiblePlaying();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [audioRef, onVisiblePlaying]);

  return hiddenWhilePlaying;
}

function usePositionReports(audioRef: RefObject<HTMLAudioElement | null>): void {
  useEffect(() => {
    const id = setInterval(() => {
      const el = audioRef.current;
      if (!el || el.paused) return;
      api.post("/api/playback/position", { positionSeconds: el.currentTime }).catch(console.error);
    }, POSITION_REPORT_MS);
    return () => clearInterval(id);
  }, [audioRef]);
}

function PlayerAudio({
  audioSongId,
  playbackState,
  onTick,
}: Omit<PlayerToggleProps, "isHost" | "isPlayer">) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const loadedItemIdRef = useRef<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const { acquire: acquireWake, release: releaseWake } = useWakeLock();
  const hiddenWhilePlaying = useVisibilityWatch(audioRef, acquireWake);
  usePositionReports(audioRef);

  const currentQueueItemId = playbackState?.currentQueueItemId ?? null;
  const isPlaying = playbackState?.isPlaying ?? false;
  const positionSeconds = playbackState?.positionSeconds ?? 0;

  const startAudio = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      await el.play();
      setBlocked(false);
      void acquireWake();
    } catch {
      setBlocked(true);
    }
  }, [acquireWake]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    loadedItemIdRef.current = audioSongId ? currentQueueItemId : null;
    loadSource(el, audioSongId);
  }, [audioSongId, currentQueueItemId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying && audioSongId && el.paused) void startAudio();
    if (!isPlaying && !el.paused) {
      el.pause();
      releaseWake();
    }
  }, [isPlaying, audioSongId, startAudio, releaseWake]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime - positionSeconds) > SEEK_TOLERANCE_SECONDS) {
      el.currentTime = positionSeconds;
    }
  }, [positionSeconds]);

  function reportEnded() {
    const expectedQueueItemId = loadedItemIdRef.current;
    if (!expectedQueueItemId) return;
    api.post("/api/playback/ended", { expectedQueueItemId }).catch(console.error);
  }

  return (
    <div className="mt-4">
      <audio
        ref={audioRef}
        preload="metadata"
        playsInline
        onEnded={reportEnded}
        onTimeUpdate={(e) => onTick?.(e.currentTarget.currentTime)}
      />
      {hiddenWhilePlaying ? (
        <p className="text-xs text-amber-400/90 mb-2 px-1">
          This tab is in the background, so iOS may pause audio. Keep the screen on and the
          tab visible while hosting playback.
        </p>
      ) : null}
      {blocked && audioSongId ? (
        <button
          type="button"
          onClick={startAudio}
          className="w-full rounded-xl bg-white text-black py-4 font-semibold min-h-12"
        >
          ▶ Tap to start audio
        </button>
      ) : null}
    </div>
  );
}

export function PlayerToggle({ isHost, isPlayer, ...audioProps }: PlayerToggleProps) {
  usePlayerClaim(isHost);
  return isPlayer ? <PlayerAudio {...audioProps} /> : null;
}
