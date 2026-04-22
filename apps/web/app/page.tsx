"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  QueueView,
  User,
  PlaybackStateView,
  SongProgressEvent,
  PlaybackTickEvent,
} from "@karaoke/shared";
import { api } from "@/lib/api";
import { loadStoredUser } from "@/lib/user";
import { useSocket } from "@/lib/socket";
import { parseLrc, type LrcLine } from "@/lib/lrc";
import { NowPlaying } from "@/components/NowPlaying";
import { QueueList } from "@/components/QueueList";
import { HostControls } from "@/components/HostControls";
import { PlayerToggle } from "@/components/PlayerToggle";
import { LyricsView } from "@/components/LyricsView";

export default function HomePage() {
  const router = useRouter();
  const socket = useSocket();
  const [user, setUser] = useState<User | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackStateView | null>(null);
  const [progress, setProgress] = useState<Map<string, SongProgressEvent>>(
    () => new Map()
  );
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [audioPosition, setAudioPosition] = useState<number | null>(null);

  useEffect(() => {
    const stored = loadStoredUser();
    if (!stored) {
      router.replace("/name");
      return;
    }
    setUser(stored);
  }, [router]);

  const fetchQueue = useCallback(async () => {
    try {
      const view = await api.get<QueueView>("/api/queue");
      setQueue(view);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchPlaybackState = useCallback(async () => {
    try {
      const state = await api.get<PlaybackStateView>("/api/playback");
      setPlaybackState(state);
    } catch {
      /* ignore */
    }
  }, []);

  // Initial fetch + socket subscriptions
  useEffect(() => {
    if (!user) return;

    // Fetch current state immediately so users see the queue + host/player state
    // before the first socket event arrives.
    fetchQueue();
    fetchPlaybackState();

    function onQueueUpdated() {
      fetchQueue();
    }

    function onPlaybackState(data: PlaybackStateView) {
      setPlaybackState(data);
    }

    function onSongProgress(data: SongProgressEvent) {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(data.songId, data);
        return next;
      });
    }

    function onHostOrPlayerChanged() {
      fetchPlaybackState();
    }

    // 1Hz tick from the active player — merge into playbackState so UI
    // surfaces that read positionSeconds (seek bar, lyric highlight) advance.
    function onPlaybackTick(data: PlaybackTickEvent) {
      setPlaybackState((prev) =>
        prev ? { ...prev, positionSeconds: data.positionSeconds } : prev,
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

  const currentSong = queue?.current?.song ?? null;

  useEffect(() => {
    if (!currentSong?.id || !currentSong.hasLyrics) {
      setLrcLines([]);
      setPlainLyrics(null);
      setAudioPosition(null);
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
  const currentAudioKey =
    current && current.song.hasInstrumental ? current.song.id : null;

  // Host heartbeat — 10s interval while user is host
  useEffect(() => {
    if (!user?.isHost) return;
    const id = setInterval(() => {
      api.post("/api/users/heartbeat").catch(console.error);
    }, 10_000);
    return () => clearInterval(id);
  }, [user]);

  if (!user) return null;

  return (
    <main className="min-h-screen flex flex-col gap-6 p-5 pb-28">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-neutral-500">
            Karaoke
          </p>
          <h1 className="text-xl font-semibold">Hi, {user.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/library"
            className="rounded-full border border-neutral-700 text-neutral-300 px-4 py-2 text-sm font-semibold"
          >
            Library
          </Link>
          <Link
            href="/search"
            className="rounded-full bg-white text-black px-4 py-2 text-sm font-semibold"
          >
            + Add song
          </Link>
        </div>
      </header>

      <section className="rounded-2xl bg-neutral-900 border border-neutral-800 p-5">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          Now playing
        </p>
        <NowPlaying current={current} playbackState={playbackState} />
        <HostControls
          user={user}
          playbackState={playbackState}
          currentSongDuration={current?.song.durationSeconds}
        />
        <PlayerToggle
          currentSongId={currentAudioKey}
          playbackState={playbackState}
          isHost={user.isHost}
          onTick={setAudioPosition}
        />
        {current && (
          <LyricsView
            lines={lrcLines}
            positionSeconds={audioPosition ?? playbackState?.positionSeconds ?? 0}
            plainText={plainLyrics ?? undefined}
          />
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-neutral-500 mb-3">
          Up next
        </h2>
        <QueueList items={queue?.upcoming ?? []} progress={progress} />
      </section>
    </main>
  );
}
