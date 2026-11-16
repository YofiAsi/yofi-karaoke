"use client";

import { useEffect, useRef, useState } from "react";
import type { LrcLine } from "@/lib/lrc";
import { activeLineIndex } from "@/lib/lyricsTiming";
import { positionAt, type PositionClock } from "@/lib/positionClock";

interface LyricsViewProps {
  lines: LrcLine[];
  positionSeconds: number;
  plainText?: string;
  expandToFill?: boolean;
  offsetMs?: number;
  clock?: PositionClock | null;
  durationSeconds?: number;
}

function useClockLineIndex(
  lines: LrcLine[],
  offsetMs: number,
  clock: PositionClock | null,
  durationSeconds: number | undefined,
): number | null {
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!clock) {
      setIndex(null);
      return;
    }
    const update = () => setIndex(activeLineIndex(lines, positionAt(clock, performance.now(), durationSeconds), offsetMs));
    update();
    if (!clock.isPlaying) return;
    let frame = requestAnimationFrame(function tick() {
      update();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [lines, offsetMs, clock, durationSeconds]);

  return index;
}

export function LyricsView({
  lines,
  positionSeconds,
  plainText,
  expandToFill,
  offsetMs = 0,
  clock = null,
  durationSeconds,
}: LyricsViewProps) {
  const activeRef = useRef<HTMLParagraphElement>(null);
  const clockIdx = useClockLineIndex(lines, offsetMs, clock, durationSeconds);
  const activeIdx = clockIdx ?? activeLineIndex(lines, positionSeconds, offsetMs);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  const lineClass = expandToFill
    ? "text-[clamp(1.35rem,4.2vw,1.9rem)] font-semibold leading-snug transition-all duration-300"
    : "text-2xl font-semibold leading-snug transition-all duration-300";

  const scrollAreaClass = expandToFill
    ? "flex-1 min-h-0 overflow-y-auto px-1 py-4 space-y-4 scroll-smooth touch-pan-y"
    : "overflow-y-auto max-h-72 px-1 py-4 space-y-4 scroll-smooth touch-pan-y";

  if (lines.length === 0 && plainText) {
    const plainLines = plainText.split("\n").filter((l) => l.trim().length > 0);
    return (
      <div className={scrollAreaClass}>
        {plainLines.map((line, i) => (
          <p key={i} dir="auto" className="text-2xl font-semibold leading-snug text-neutral-600 text-start">
            {line}
          </p>
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    const message = (
      <p dir="rtl" className="text-neutral-500 text-center py-8 text-lg">
        לול לא מצאתי מילים
      </p>
    );
    if (expandToFill) {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
          {message}
        </div>
      );
    }
    return message;
  }

  return (
    <div className={scrollAreaClass}>
      {lines.map((line, i) => (
        <p
          key={i}
          ref={i === activeIdx ? activeRef : undefined}
          dir="auto"
          className={`${lineClass} text-start ${
            i === activeIdx ? "text-white" : "text-neutral-600"
          }`}
        >
          {line.text || "\u00A0"}
        </p>
      ))}
    </div>
  );
}
