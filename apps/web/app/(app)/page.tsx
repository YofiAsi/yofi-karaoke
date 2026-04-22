"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppShell } from "./AppShellContext";
import { NowPlaying } from "@/components/NowPlaying";
import { HostControls } from "@/components/HostControls";
import { LyricsView } from "@/components/LyricsView";
import { QueueDrawer } from "@/components/QueueDrawer";

export default function HomePage() {
  const {
    user,
    queue,
    playbackState,
    progress,
    lrcLines,
    plainLyrics,
    audioPosition,
    refetchQueue,
  } = useAppShell();
  const [queueOpen, setQueueOpen] = useState(false);

  if (!user) return null;

  const current = queue?.current ?? null;
  const upcoming = queue?.upcoming ?? [];
  const upcomingCount = upcoming.length;

  return (
    <main className="min-h-dvh flex flex-col">
      <header
        className="shrink-0 flex items-center justify-between px-5 pb-3"
        style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top, 0px))" }}
      >
        <div>
          <p className="text-xs uppercase tracking-widest text-neutral-500">Karaoke</p>
          <h1 className="text-xl font-semibold">Hi, {user.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {user.isHost && (
            <Link
              href="/library"
              className="rounded-full border border-neutral-700 text-neutral-300 px-4 py-2.5 text-sm font-semibold min-h-11 inline-flex items-center"
            >
              Library
            </Link>
          )}
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="rounded-full border border-neutral-700 text-neutral-300 px-4 py-2.5 text-sm font-semibold min-h-11 inline-flex items-center"
          >
            Queue{upcomingCount > 0 ? ` · ${upcomingCount}` : ""}
          </button>
        </div>
      </header>

      <section className="flex-1 flex flex-col min-h-0 w-full bg-neutral-900 border-t border-neutral-800 px-5 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
        <p className="text-xs uppercase tracking-widest text-neutral-500 shrink-0">
          Now playing
        </p>
        <div className="shrink-0">
          <NowPlaying current={current} playbackState={playbackState} />
          <HostControls
            user={user}
            playbackState={playbackState}
            currentSongDuration={current?.song.durationSeconds}
          />
        </div>
        {current && (
          <LyricsView
            lines={lrcLines}
            positionSeconds={audioPosition ?? playbackState?.positionSeconds ?? 0}
            plainText={plainLyrics ?? undefined}
            expandToFill
          />
        )}
      </section>

      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        items={upcoming}
        progress={progress}
        canRetryAsHost={
          !!user.isHost && playbackState?.hostUserId === user.id
        }
        onQueueChanged={refetchQueue}
      />
    </main>
  );
}
