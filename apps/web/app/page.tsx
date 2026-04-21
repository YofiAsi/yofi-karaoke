"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueView, User } from "@karaoke/shared";
import { api } from "@/lib/api";
import { loadStoredUser } from "@/lib/user";
import { AudioController } from "@/lib/audio";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
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
      /* ignore; will retry */
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchQueue();
    const id = setInterval(fetchQueue, 3_000);
    return () => clearInterval(id);
  }, [user, fetchQueue]);

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
        {current ? (
          <>
            <h2 className="text-2xl font-semibold leading-tight mt-1">
              {current.song.title}
            </h2>
            <p className="text-neutral-400 text-sm mt-1">
              {current.song.artist} · requested by {current.requestedByUserName}
            </p>
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
        ) : (
          <p className="text-neutral-500 mt-3">
            Queue is empty. Add a song to start.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-neutral-500 mb-3">
          Up next
        </h2>
        {queue && queue.upcoming.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {queue.upcoming.map((item) => (
              <li
                key={item.id}
                className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-center gap-3"
              >
                <img
                  src={item.song.thumbnailUrl}
                  alt=""
                  className="h-12 w-12 rounded-md object-cover bg-neutral-800"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.song.title}</p>
                  <p className="text-xs text-neutral-400 truncate">
                    {item.song.artist} · {item.requestedByUserName}
                  </p>
                </div>
                <StateBadge item={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-neutral-500">Nothing queued yet.</p>
        )}
      </section>
    </main>
  );
}

function StateBadge({ item }: { item: QueueView["upcoming"][number] }) {
  if (item.state === "ready") {
    return <span className="text-xs text-emerald-400">ready</span>;
  }
  if (item.state === "failed") {
    return <span className="text-xs text-red-400">failed</span>;
  }
  const pct = item.progress?.progressPct ?? 0;
  const step = item.progress?.step ?? "pending";
  return (
    <span className="text-xs text-neutral-400">
      {step} · {pct}%
    </span>
  );
}
