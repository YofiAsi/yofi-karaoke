"use client";

import { useEffect, useState } from "react";
import type { PlaybackStateView } from "@karaoke/shared";
import { api } from "@/lib/api";

interface HostControlsProps {
  isHost: boolean;
  playbackState: PlaybackStateView | null;
  currentSongDuration?: number;
  currentSongId?: string;
  lyricsOffsetMs?: number;
  onLyricsOffsetChange?: (offsetMs: number) => void;
}

const OFFSET_STEP_MS = 500;

function formatOffset(offsetMs: number): string {
  const seconds = (offsetMs / 1000).toFixed(1);
  return offsetMs > 0 ? `+${seconds}s` : `${seconds}s`;
}

export function HostControls({
  isHost,
  playbackState,
  currentSongDuration,
  currentSongId,
  lyricsOffsetMs = 0,
  onLyricsOffsetChange,
}: HostControlsProps) {
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const [refetchState, setRefetchState] = useState<"idle" | "sent" | "failed">("idle");

  useEffect(() => setRefetchState("idle"), [currentSongId]);

  if (!isHost) return null;

  const isPlaying = playbackState?.isPlaying ?? false;
  const displaySeek = seekValue !== null ? seekValue : (playbackState?.positionSeconds ?? 0);
  const transition = { expectedQueueItemId: playbackState?.currentQueueItemId ?? null };

  async function handlePlay() {
    await api.post("/api/playback/play").catch(console.error);
  }

  async function handlePause() {
    await api.post("/api/playback/pause").catch(console.error);
  }

  async function handleSkip() {
    await api.post("/api/playback/skip", transition).catch(console.error);
  }

  async function handlePrev() {
    await api.post("/api/playback/previous", transition).catch(console.error);
  }

  async function handleSeekCommit(value: number) {
    await api.post("/api/playback/seek", { positionSeconds: value }).catch(console.error);
    setSeekValue(null);
  }

  async function handleRefetchLyrics() {
    if (!currentSongId) return;
    try {
      await api.post(`/api/songs/${currentSongId}/lyrics/refetch`);
      setRefetchState("sent");
    } catch (err) {
      console.error(err);
      setRefetchState("failed");
    }
  }

  async function handleOffsetStep(deltaMs: number) {
    if (!currentSongId) return;
    const offsetMs = lyricsOffsetMs + deltaMs;
    onLyricsOffsetChange?.(offsetMs);
    await api.post(`/api/songs/${currentSongId}/lyrics/offset`, { offsetMs }).catch((err) => {
      console.error(err);
      onLyricsOffsetChange?.(lyricsOffsetMs);
    });
  }

  return (
    <div className="mt-5 rounded-2xl bg-neutral-800 border border-neutral-700 p-4 flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest text-neutral-400 text-center">
        Host Controls
      </p>

      {/* Transport buttons */}
      <div className="flex items-center justify-center gap-3">
        {/* Prev */}
        <button
          onClick={handlePrev}
          aria-label="Previous"
          className="w-10 h-10 rounded-full bg-neutral-700 hover:bg-neutral-600 active:bg-neutral-500 flex items-center justify-center text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>

        {/* Play / Pause toggle */}
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="w-14 h-14 rounded-full bg-white hover:bg-neutral-200 active:bg-neutral-300 flex items-center justify-center text-black transition-colors"
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Skip */}
        <button
          onClick={handleSkip}
          aria-label="Skip"
          className="w-10 h-10 rounded-full bg-neutral-700 hover:bg-neutral-600 active:bg-neutral-500 flex items-center justify-center text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="m6 18 8.5-6L6 6v12zm2-8.14 4.96 2.14L8 14.14V9.86zM16 6h2v12h-2z" />
          </svg>
        </button>
      </div>

      {/* Seek bar — only rendered when duration is known */}
      {currentSongDuration !== undefined && currentSongDuration > 0 && (
        <input
          type="range"
          min={0}
          max={currentSongDuration}
          value={displaySeek}
          onChange={(e) => setSeekValue(Number(e.target.value))}
          onMouseUp={(e) => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
          className="w-full accent-white"
          aria-label="Seek"
        />
      )}

      {currentSongId && (
        <div className="flex items-center justify-between gap-2 text-sm text-neutral-300">
          <div className="flex items-center gap-1" aria-label="Lyrics timing">
            <button
              onClick={() => handleOffsetStep(-OFFSET_STEP_MS)}
              aria-label="Show lyrics 0.5 seconds earlier"
              className="w-9 h-9 rounded-full bg-neutral-700 hover:bg-neutral-600 active:bg-neutral-500 text-white"
            >
              −
            </button>
            <span className="w-14 text-center tabular-nums">{formatOffset(lyricsOffsetMs)}</span>
            <button
              onClick={() => handleOffsetStep(OFFSET_STEP_MS)}
              aria-label="Show lyrics 0.5 seconds later"
              className="w-9 h-9 rounded-full bg-neutral-700 hover:bg-neutral-600 active:bg-neutral-500 text-white"
            >
              +
            </button>
          </div>
          <button
            onClick={handleRefetchLyrics}
            disabled={refetchState === "sent"}
            className="rounded-full border border-neutral-600 px-3 py-1.5 hover:bg-neutral-700 disabled:opacity-50"
          >
            {refetchState === "sent" ? "Searching lyrics…" : refetchState === "failed" ? "Retry lyrics search" : "Find lyrics again"}
          </button>
        </div>
      )}
    </div>
  );
}
