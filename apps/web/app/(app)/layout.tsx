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
import { loadStoredUser, validateStoredUser } from "@/lib/user";
import { isCurrentHost, isPlayerDevice } from "@/lib/roles";
import { useSocket } from "@/lib/socket";
import { parseLrc, type LrcLine } from "@/lib/lrc";
import { PlayerToggle } from "@/components/PlayerToggle";
import { AppShellContext } from "./AppShellContext";

interface LyricsResponse {
  lrc: string | null;
  plain: string | null;
  offsetMs?: number;
}

function toLyricsState({ lrc, plain }: LyricsResponse) {
  const lines = parseLrc(lrc);
  return { lines, plain: plain ?? (lines.length === 0 ? lrc : null) };
}

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
  const [lyricsVersion, setLyricsVersion] = useState(0);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    validateStoredUser().then((validated) => {
      if (!cancelled) setUser(validated);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

    function onQueueUpdated() {
      fetchQueue();
      setLyricsVersion((v) => v + 1);
    }
    function onPlaybackState(data: PlaybackStateView) { setPlaybackState(data); }
    function onSongProgress(data: SongProgressEvent) {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(data.songId, data);
        return next;
      });
    }
    function onHostOrPlayerChanged() { fetchPlaybackState(); }
    function onReconnect() {
      fetchQueue();
      fetchPlaybackState();
    }
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
    socket.io.on("reconnect", onReconnect);

    return () => {
      socket.off("queue:updated", onQueueUpdated);
      socket.off("playback:state", onPlaybackState);
      socket.off("playback:tick", onPlaybackTick);
      socket.off("song:progress", onSongProgress);
      socket.off("host:changed", onHostOrPlayerChanged);
      socket.off("player:changed", onHostOrPlayerChanged);
      socket.io.off("reconnect", onReconnect);
    };
  }, [user, socket, fetchQueue, fetchPlaybackState]);

  const isHost = isCurrentHost(user, playbackState);
  const isPlayer = isPlayerDevice(user, playbackState);

  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      api.post("/api/users/heartbeat").catch(console.error);
    }, 10_000);
    return () => clearInterval(id);
  }, [isHost]);

  const currentSong = queue?.current?.song ?? null;

  useEffect(() => {
    if (!currentSong?.id || !currentSong.hasLyrics) {
      setLrcLines([]);
      setPlainLyrics(null);
      setLyricsOffsetMs(0);
      return;
    }
    api
      .get<LyricsResponse>(`/api/songs/${currentSong.id}/lyrics`)
      .then((res) => {
        const { lines, plain } = toLyricsState(res);
        setLrcLines(lines);
        setPlainLyrics(plain);
        setLyricsOffsetMs(res.offsetMs ?? 0);
      })
      .catch(() => {
        setLrcLines([]);
        setPlainLyrics(null);
      });
  }, [currentSong?.id, currentSong?.hasLyrics, lyricsVersion]);

  const current = queue?.current ?? null;
  const audioSource = current?.song.hasInstrumental
    ? { queueItemId: current.id, songId: current.song.id }
    : null;

  if (!user) return null;

  return (
    <AppShellContext.Provider
      value={{
        user,
        isHost,
        queue,
        playbackState,
        progress,
        lrcLines,
        plainLyrics,
        lyricsOffsetMs,
        setLyricsOffsetMs,
        audioPosition,
        setAudioPosition,
        refetchQueue: fetchQueue,
      }}
    >
      <PlayerToggle
        isHost={isHost}
        isPlayer={isPlayer}
        source={audioSource}
        playbackState={playbackState}
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
