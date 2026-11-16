"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppShell } from "./AppShellContext";
import { NowPlaying } from "@/components/NowPlaying";
import { HostControls } from "@/components/HostControls";
import { LyricsDisplaySwitch, useLyricsDisplay } from "@/components/lyricsDisplays";
import { QueueDrawer } from "@/components/QueueDrawer";
import { VocalsSlider } from "@/components/VocalsSlider";
import { canControlVocals } from "@/lib/roles";

export default function HomePage() {
  const {
    user,
    isHost,
    queue,
    playbackState,
    progress,
    lrcLines,
    plainLyrics,
    wordTimings,
    lyricsSongId,
    lyricsOffsetMs,
    lyricsSource,
    setLyricsOffsetMs,
    lyricsPosition,
    refetchQueue,
    positionClock,
    playerPosition,
    failedVocalsSongId,
  } = useAppShell();
  const [queueOpen, setQueueOpen] = useState(false);
  const { display, choose } = useLyricsDisplay("home");

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
          {isHost && (
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
        <div className="shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-widest text-neutral-500">Now playing</p>
          <LyricsDisplaySwitch selectedId={display.id} onChoose={choose} />
        </div>
        <div className="shrink-0">
          <NowPlaying
            current={current}
            playbackState={playbackState}
            hasReadyUpcoming={upcoming.some((i) => i.state === "ready")}
          />
          <HostControls
            isHost={isHost}
            playbackState={playbackState}
            currentSongDuration={current?.song.durationSeconds}
            currentSongId={current?.song.id}
            currentSongTitle={current?.song.title}
            lyricsOffsetMs={lyricsOffsetMs}
            onLyricsOffsetChange={setLyricsOffsetMs}
          />
          {current && canControlVocals(user, isHost, current) && (
            <VocalsSlider
              key={current.id}
              queueItemId={current.id}
              hasVocals={current.song.hasVocals}
              failed={failedVocalsSongId === current.song.id}
              serverGain={playbackState?.vocalsGain ?? 0}
            />
          )}
        </div>
        {current && (
          <display.Component
            key={`${display.id}:${current.id}`}
            songId={current.song.id}
            lyricsSongId={lyricsSongId}
            lines={lrcLines}
            wordTimings={wordTimings}
            positionSeconds={lyricsPosition}
            plainText={plainLyrics ?? undefined}
            offsetMs={lyricsOffsetMs}
            source={lyricsSource}
            clock={positionClock}
            playerPosition={playerPosition}
            durationSeconds={current.song.durationSeconds}
            surface="home"
          />
        )}
      </section>

      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        items={upcoming}
        progress={progress}
        currentUser={user}
        isHost={isHost}
        onQueueChanged={refetchQueue}
      />
    </main>
  );
}
