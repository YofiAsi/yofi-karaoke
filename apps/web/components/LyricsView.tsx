"use client";

import { useEffect, useRef } from "react";
import type { LrcLine } from "@/lib/lrc";

interface LyricsViewProps {
  lines: LrcLine[];
  positionSeconds: number;
  plainText?: string;
}

export function LyricsView({ lines, positionSeconds, plainText }: LyricsViewProps) {
  const activeRef = useRef<HTMLParagraphElement>(null);

  const adjustedPosition = positionSeconds + 0.3;
  let activeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= adjustedPosition) {
      activeIdx = i;
    }
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  if (lines.length === 0 && plainText) {
    const plainLines = plainText.split("\n").filter((l) => l.trim().length > 0);
    return (
      <div className="overflow-y-auto max-h-72 px-1 py-4 space-y-4 scroll-smooth">
        {plainLines.map((line, i) => (
          <p key={i} className="text-2xl font-semibold leading-snug text-neutral-600">
            {line}
          </p>
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <p className="text-neutral-500 text-center py-8 text-lg">
        Instrumental — no lyrics available.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto max-h-72 px-1 py-4 space-y-4 scroll-smooth">
      {lines.map((line, i) => (
        <p
          key={i}
          ref={i === activeIdx ? activeRef : undefined}
          className={`text-2xl font-semibold leading-snug transition-all duration-300 ${
            i === activeIdx ? "text-white" : "text-neutral-600"
          }`}
        >
          {line.text || "\u00A0"}
        </p>
      ))}
    </div>
  );
}
