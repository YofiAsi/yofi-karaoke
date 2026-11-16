"use client";

import { createContext, useContext } from "react";
import type {
  User,
  QueueView,
  PlaybackStateView,
  SongProgressEvent,
  LyricsWordTimings,
} from "@karaoke/shared";
import type { LrcLine } from "@/lib/lrc";
import type { PositionClock } from "@/lib/positionClock";
import type { PlayerPositionReader } from "@/lib/livePosition";

export interface AppShellState {
  user: User | null;
  isHost: boolean;
  queue: QueueView | null;
  playbackState: PlaybackStateView | null;
  progress: Map<string, SongProgressEvent>;
  lrcLines: LrcLine[];
  plainLyrics: string | null;
  wordTimings?: LyricsWordTimings | null;
  lyricsLoading?: boolean;
  lyricsOffsetMs: number;
  lyricsSource?: string | null;
  setLyricsOffsetMs: (offsetMs: number) => void;
  lyricsPosition: number;
  refetchQueue: () => Promise<void>;
  positionClock?: PositionClock | null;
  playerPosition?: PlayerPositionReader | null;
  failedVocalsSongId?: string | null;
}

export const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShell(): AppShellState {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used inside AppShellProvider");
  return ctx;
}
