"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  QueueView,
  PlaybackStateView,
  SongProgressEvent,
  PlaybackTickEvent,
} from "@karaoke/shared";
import { api } from "@/lib/api";
import { loadStoredUser } from "@/lib/user";
import { useSocket } from "@/lib/socket";
import { parseLrc, type LrcLine } from "@/lib/lrc";
import { PlayerToggle } from "@/components/PlayerToggle";
import { AppShellContext } from "./AppShellContext";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const socket = useSocket();
  const [user, setUser] = useState(() => loadStoredUser());
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackStateView | null>(null);
  const [progress, setProgress] = useState<Map<string, SongProgressEvent>>(() => new Map());
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [audioPosition, setAudioPosition] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      router.replace("/name");
    }
  }, [user, router]);

  const fetchQueue = useCallback(async () => {
    try {
      setQueue(await api.get<QueueView>("/api/queue"));
    } catch { /* ignore */ }
  }, []);

  const fetchPlaybackState = useCallback(async () => {
    try {
      setPlaybackState(await api.get<PlaybackStateView>("/api/playback"));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchQueue();
    fetchPlaybackState();

    function onQueueUpdated() { fetchQueue(); }
    function onPlaybackState(data: PlaybackStateView) { setPlaybackState(data); }
    function onSongProgress(data: SongProgressEvent) {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(data.songId, data);
        return next;
      });
    }
    function onHostOrPlayerChanged() { fetchPlaybackState(); }
    function onPlaybackTick(data: PlaybackTickEvent) {
      setPlaybackState((prev) =>
        prev ? { ...prev, positionSeconds: data.positionSeconds } : prev
      );
    }

    socket.on("queue:updated", onQueueUpdated);
    socket.on("playback:state", onPlaybackState);
    socket.on("playback:tick", onPlaybackTick);
    socket.on("song:progress", onSongProgress);
    socket.on("host:changed", onHostOrPlayerChanged);
    socket.on("player:changed", onHostOrPlayerChanged);

    return () => {
      socket.off("queue:updated", onQueueUpdated);
      socket.off("playback:state", onPlaybackState);
      socket.off("playback:tick", onPlaybackTick);
      socket.off("song:progress", onSongProgress);
      socket.off("host:changed", onHostOrPlayerChanged);
      socket.off("player:changed", onHostOrPlayerChanged);
    };
  }, [user, socket, fetchQueue, fetchPlaybackState]);

  useEffect(() => {
    if (!user?.isHost) return;
    const id = setInterval(() => {
      api.post("/api/users/heartbeat").catch(console.error);
    }, 10_000);
    return () => clearInterval(id);
  }, [user]);

  const currentSong = queue?.current?.song ?? null;

  useEffect(() => {
    if (!currentSong?.id || !currentSong.hasLyrics) {
      setLrcLines([]);
      setPlainLyrics(null);
      return;
    }
    api
      .get<{ lrc: string | null; plain: string | null }>(`/api/songs/${currentSong.id}/lyrics`)
      .then(({ lrc, plain }) => {
        setLrcLines(parseLrc(lrc));
        setPlainLyrics(lrc ? null : plain);
      })
      .catch(() => {
        setLrcLines([]);
        setPlainLyrics(null);
      });
  }, [currentSong?.id, currentSong?.hasLyrics]);

  const current = queue?.current ?? null;
  const currentAudioKey = current?.song.hasInstrumental ? current.song.id : null;

  if (!user) return null;

  return (
    <AppShellContext.Provider
      value={{
        user,
        queue,
        playbackState,
        progress,
        lrcLines,
        plainLyrics,
        audioPosition,
        setAudioPosition,
        refetchQueue: fetchQueue,
      }}
    >
      <PlayerToggle
        currentSongId={currentAudioKey}
        playbackState={playbackState}
        isHost={user.isHost}
        onTick={setAudioPosition}
      />
      {children}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-md px-4 pt-2 flex justify-center"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
        aria-label="Primary"
      >
        <Link
          href="/search"
          className="w-full max-w-md rounded-2xl bg-white text-black py-3.5 text-center text-base font-semibold min-h-12 flex items-center justify-center active:opacity-90"
        >
          Add a song
        </Link>
      </nav>
    </AppShellContext.Provider>
  );
}
