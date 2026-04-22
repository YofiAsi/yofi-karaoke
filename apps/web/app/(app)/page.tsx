"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppShell } from "./AppShellContext";
import { NowPlaying } from "@/components/NowPlaying";
import { HostControls } from "@/components/HostControls";
import { LyricsView } from "@/components/LyricsView";
import { QueueDrawer } from "@/components/QueueDrawer";

export default function HomePage() {
  const { user, queue, playbackState, progress, lrcLines, plainLyrics, audioPosition } =
    useAppShell();
  const [queueOpen, setQueueOpen] = useState(false);

  if (!user) return null;

  const current = queue?.current ?? null;
  const upcoming = queue?.upcoming ?? [];
  const upcomingCount = upcoming.length;

  return (
    <main className="min-h-screen flex flex-col gap-6 p-5 pb-28">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-neutral-500">Karaoke</p>
          <h1 className="text-xl font-semibold">Hi, {user.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {user.isHost && (
            <Link
              href="/library"
              className="rounded-full border border-neutral-700 text-neutral-300 px-4 py-2 text-sm font-semibold"
            >
              Library
            </Link>
          )}
          <button
            onClick={() => setQueueOpen(true)}
            className="rounded-full border border-neutral-700 text-neutral-300 px-4 py-2 text-sm font-semibold"
          >
            Queue{upcomingCount > 0 ? ` · ${upcomingCount}` : ""}
          </button>
          <Link
            href="/search"
            className="rounded-full bg-white text-black px-4 py-2 text-sm font-semibold"
          >
            + Add song
          </Link>
        </div>
      </header>

      <section className="rounded-2xl bg-neutral-900 border border-neutral-800 p-5">
        <p className="text-xs uppercase tracking-widest text-neutral-500">Now playing</p>
        <NowPlaying current={current} playbackState={playbackState} />
        <HostControls
          user={user}
          playbackState={playbackState}
          currentSongDuration={current?.song.durationSeconds}
        />
        {current && (
          <LyricsView
            lines={lrcLines}
            positionSeconds={audioPosition ?? playbackState?.positionSeconds ?? 0}
            plainText={plainLyrics ?? undefined}
          />
        )}
      </section>

      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        items={upcoming}
        progress={progress}
      />
    </main>
  );
}
