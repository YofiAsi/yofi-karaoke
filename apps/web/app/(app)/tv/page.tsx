"use client";

import type { QueueItem } from "@karaoke/shared";
import { LyricsView } from "@/components/LyricsView";
import { JoinQrCode } from "@/components/JoinQrCode";
import { upNext } from "@/lib/upNext";
import { useAppShell } from "../AppShellContext";

const UP_NEXT_COUNT = 3;
const TV_LYRICS_SIZE = "[&_p]:!text-[clamp(2rem,4.2vw,4.75rem)] [&_p]:!leading-tight";

function NowSinging({ item }: { item: QueueItem }) {
  return (
    <header className="shrink-0">
      <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">Now singing</p>
      <h1 dir="auto" className="mt-2 text-[clamp(2rem,3.5vw,3.75rem)] font-bold leading-tight text-start line-clamp-2">
        {item.song.title}
      </h1>
      <p className="mt-2 text-[clamp(1.1rem,1.8vw,1.9rem)] text-neutral-300 truncate">
        <bdi>{item.requestedByUserName}</bdi>
        <span className="text-neutral-500"> · </span>
        <bdi className="text-neutral-400">{item.song.artist}</bdi>
      </p>
    </header>
  );
}

function IdleMessage({ hasUpcoming }: { hasUpcoming: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
      <p className="text-[clamp(2rem,4vw,4.5rem)] font-bold">
        {hasUpcoming ? "Get ready to sing" : "Who is singing first?"}
      </p>
      <p className="text-[clamp(1.1rem,1.8vw,1.9rem)] text-neutral-400">
        {hasUpcoming ? "The next song starts soon." : "Scan the code and add a song from your phone."}
      </p>
    </div>
  );
}

function UpNextList({ items }: { items: QueueItem[] }) {
  return (
    <section>
      <h2 className="text-sm uppercase tracking-[0.3em] text-neutral-500">Up next</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-lg text-neutral-500">Nothing queued yet.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <p dir="auto" className="text-[clamp(1.1rem,1.6vw,1.6rem)] font-semibold leading-snug text-start line-clamp-2">
                {item.song.title}
              </p>
              <p className="text-[clamp(0.95rem,1.2vw,1.25rem)] text-neutral-400 truncate">
                <bdi>{item.requestedByUserName}</bdi>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function TvPage() {
  const { queue, lrcLines, plainLyrics, lyricsOffsetMs, lyricsSource, lyricsPosition, positionClock } = useAppShell();
  const current = queue?.current ?? null;
  const upcoming = queue?.upcoming ?? [];

  return (
    <div className="fixed inset-0 z-[100] flex bg-[#0b0b10] text-white overflow-hidden">
      <main className="flex-1 min-w-0 flex flex-col gap-6 p-[clamp(1.5rem,3vw,3.5rem)]">
        {current ? (
          <>
            <NowSinging item={current} />
            <div className={`flex-1 min-h-0 flex flex-col ${TV_LYRICS_SIZE}`}>
              <LyricsView
                key={current.id}
                lines={lrcLines}
                positionSeconds={lyricsPosition}
                plainText={plainLyrics ?? undefined}
                offsetMs={lyricsOffsetMs}
                source={lyricsSource}
                clock={positionClock}
                durationSeconds={current.song.durationSeconds}
                expandToFill
              />
            </div>
          </>
        ) : (
          <IdleMessage hasUpcoming={upcoming.length > 0} />
        )}
      </main>
      <aside className="w-[clamp(15rem,24vw,26rem)] shrink-0 border-s border-neutral-800 bg-neutral-950 flex flex-col gap-8 p-[clamp(1.25rem,2vw,2.5rem)]">
        <UpNextList items={upNext(upcoming, UP_NEXT_COUNT)} />
        <div className="mt-auto">
          <JoinQrCode />
        </div>
      </aside>
    </div>
  );
}
