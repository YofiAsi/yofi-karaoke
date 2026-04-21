"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { PlaybackStateView, PlayerChangedEvent, PlaybackTickEvent } from "@karaoke/shared";

interface PlayerToggleProps {
  currentSongId: string | null;
  playbackState: PlaybackStateView | null;
  currentUserId: string;
}

export function PlayerToggle({
  currentSongId,
  playbackState,
  currentUserId,
}: PlayerToggleProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [tickPosition, setTickPosition] = useState<number | null>(null);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // keep a ref so callbacks always see latest value without re-subscribing
  const isActiveRef = useRef(false);
  // keep a ref so the ended handler always sees latest playbackState
  const playbackStateRef = useRef(playbackState);

  function stopPlaying() {
    audioRef.current?.pause();
    if (positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
      positionIntervalRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    isActiveRef.current = false;
    setIsActive(false);
  }

  // React to player:changed — stop playing if someone else claimed the role
  useEffect(() => {
    const socket = getSocket();
    function onPlayerChanged(data: PlayerChangedEvent) {
      if (isActiveRef.current && data.playerUserId !== currentUserId) {
        stopPlaying();
      }
    }
    socket.on("player:changed", onPlayerChanged);
    return () => {
      socket.off("player:changed", onPlayerChanged);
    };
  }, [currentUserId]);

  // Subscribe to playback:tick (for lyric sync, Phase 3)
  useEffect(() => {
    const socket = getSocket();
    function onTick(data: PlaybackTickEvent) {
      if (!isActiveRef.current) {
        setTickPosition(data.positionSeconds);
      }
    }
    socket.on("playback:tick", onTick);
    return () => {
      socket.off("playback:tick", onTick);
    };
  }, []);

  // Keep playbackStateRef in sync with the latest prop value
  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  // Pause/reset when song changes
  useEffect(() => {
    if (isActiveRef.current) {
      stopPlaying();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSongId]);

  // Handle audio ended — auto-advance or notify server
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    async function handleAudioEnded() {
      if (!isActiveRef.current) return;
      const socket = getSocket();
      const state = playbackStateRef.current;
      if (state?.hostUserId === currentUserId) {
        // This device is both player and host — skip directly via API
        await api.post("/api/playback/skip").catch(console.error);
      } else {
        // Player only — notify server; it will auto-advance after a 3s grace period
        socket.emit("playback:ended");
      }
      stopPlaying();
    }

    el.addEventListener("ended", handleAudioEnded);
    return () => {
      el.removeEventListener("ended", handleAudioEnded);
    };
    // currentUserId is stable; stopPlaying/api/getSocket are module-level — no dep needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (positionIntervalRef.current) clearInterval(positionIntervalRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  }, []);

  async function handlePlayHere() {
    if (!currentSongId) return;
    try {
      await api.post("/api/player/claim");
      const el = audioRef.current;
      if (!el) return;
      el.src = `/api/audio/${currentSongId}`;
      await el.play();
      isActiveRef.current = true;
      setIsActive(true);
      positionIntervalRef.current = setInterval(() => {
        api
          .post("/api/playback/position", { positionSeconds: el.currentTime })
          .catch(console.error);
      }, 1000);
      heartbeatIntervalRef.current = setInterval(() => {
        api.post("/api/player/heartbeat").catch(console.error);
      }, 10_000);
    } catch (err) {
      console.error("Failed to claim player role", err);
    }
  }

  async function handleStopHere() {
    await api.post("/api/player/release").catch(console.error);
    stopPlaying();
  }

  // Expose tickPosition for Phase 3 — suppress unused warning until then
  void tickPosition;

  if (!currentSongId) return null;

  return (
    <div className="mt-4">
      <audio ref={audioRef} preload="metadata" playsInline />
      <button
        onClick={isActive ? handleStopHere : handlePlayHere}
        className={`w-full rounded-xl py-4 font-semibold ${
          isActive ? "bg-neutral-800 text-white" : "bg-white text-black"
        }`}
      >
        {isActive ? "Stop playing here" : "Play here"}
      </button>
    </div>
  );
}
