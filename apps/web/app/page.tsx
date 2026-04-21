"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  QueueView,
  User,
  PlaybackStateView,
  SongProgressEvent,
} from "@karaoke/shared";
import { api } from "@/lib/api";
import { loadStoredUser } from "@/lib/user";
import { AudioController } from "@/lib/audio";
import { useSocket } from "@/lib/socket";
import { NowPlaying } from "@/components/NowPlaying";
import { QueueList } from "@/components/QueueList";
import { HostControls } from "@/components/HostControls";

export default function HomePage() {
  const router = useRouter();
  const socket = useSocket();
  const [user, setUser] = useState<User | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackStateView | null>(null);
  const [progress, setProgress] = useState<Map<string, SongProgressEvent>>(
    () => new Map()
  );
  const [isPlayingHere, setIsPlayingHere] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controllerRef = useRef<AudioController | null>(null);

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

  // Initial fetch + socket subscriptions
  useEffect(() => {
    if (!user) return;

    // Fetch current state immediately so users see the queue before first event
    fetchQueue();

    function onQueueUpdated(data: QueueView) {
      setQueue(data);
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

    socket.on("queue:updated", onQueueUpdated);
    socket.on("playback:state", onPlaybackState);
    socket.on("song:progress", onSongProgress);

    return () => {
      socket.off("queue:updated", onQueueUpdated);
      socket.off("playback:state", onPlaybackState);
      socket.off("song:progress", onSongProgress);
    };
  }, [user, socket, fetchQueue]);

  const current = queue?.current ?? null;
  const currentAudioKey =
    current && current.song.hasInstrumental ? current.song.id : null;

  useEffect(() => {
    if (!currentAudioKey) return;
    const el = audioRef.current;
    if (!el) return;
    const ctrl = new AudioController({
      onPause: () => setIsPlayingHere(false),
      onPlay: () => setIsPlayingHere(true),
      onEnded: () => {
        setIsPlayingHere(false);
        fetchQueue();
      },
    });
    ctrl.attach(el);
    controllerRef.current = ctrl;
    return () => {
      ctrl.detach();
      controllerRef.current = null;
    };
  }, [currentAudioKey, fetchQueue]);

  async function togglePlayHere() {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (isPlayingHere) {
      ctrl.pause();
      return;
    }
    if (!current) return;
    try {
      await ctrl.play();
    } catch (err) {
      console.error("play failed", err);
    }
  }

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
        <Link
          href="/search"
          className="rounded-full bg-white text-black px-4 py-2 text-sm font-semibold"
        >
          + Add song
        </Link>
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
        {current && (
          <>
            <button
              onClick={togglePlayHere}
              className={`mt-5 w-full rounded-xl py-4 font-semibold ${
                isPlayingHere
                  ? "bg-neutral-800 text-white"
                  : "bg-white text-black"
              }`}
            >
              {isPlayingHere ? "Stop playing here" : "Play here"}
            </button>
            {current.song.hasInstrumental && (
              <audio
                ref={audioRef}
                src={`/api/audio/${current.song.id}`}
                preload="metadata"
                playsInline
              />
            )}
          </>
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
