"use client";

import { createContext, useContext } from "react";
import type {
  User,
  QueueView,
  PlaybackStateView,
  SongProgressEvent,
} from "@karaoke/shared";
import type { LrcLine } from "@/lib/lrc";
import type { PositionClock } from "@/lib/positionClock";

export interface AppShellState {
  user: User | null;
  isHost: boolean;
  queue: QueueView | null;
  playbackState: PlaybackStateView | null;
  progress: Map<string, SongProgressEvent>;
  lrcLines: LrcLine[];
  plainLyrics: string | null;
  lyricsOffsetMs: number;
  lyricsSource?: string | null;
  setLyricsOffsetMs: (offsetMs: number) => void;
  audioPosition: number | null;
  setAudioPosition: (pos: number) => void;
  refetchQueue: () => Promise<void>;
  positionClock?: PositionClock | null;
  failedVocalsSongId?: string | null;
}

export const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShell(): AppShellState {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used inside AppShellProvider");
  return ctx;
}
