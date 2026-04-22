"use client";

import { createContext, useContext } from "react";
import type {
  User,
  QueueView,
  PlaybackStateView,
  SongProgressEvent,
} from "@karaoke/shared";
import type { LrcLine } from "@/lib/lrc";

export interface AppShellState {
  user: User | null;
  queue: QueueView | null;
  playbackState: PlaybackStateView | null;
  progress: Map<string, SongProgressEvent>;
  lrcLines: LrcLine[];
  plainLyrics: string | null;
  audioPosition: number | null;
  setAudioPosition: (pos: number) => void;
}

export const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShell(): AppShellState {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used inside AppShellProvider");
  return ctx;
}
