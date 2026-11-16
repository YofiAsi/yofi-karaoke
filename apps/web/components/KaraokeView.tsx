"use client";

// Classic karaoke display: two fixed slots that alternate lines, a word by word fill, and a dot countdown before singing.
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { LyricsWordTimings } from "@karaoke/shared";
import type { LrcLine } from "@/lib/lrc";
import { buildKaraokeLines, type KaraokeLine } from "@/lib/karaokeLines";
import { COUNTDOWN_DOTS, countdownDots, slotContents, type SlotContent } from "@/lib/karaokeSlots";
import { fillStyle, lineDirection, lineFills, wordDirection } from "@/lib/karaokeFill";
import { fillTime, lyricsTime, type PlayerPositionReader } from "@/lib/livePosition";
import type { PositionClock } from "@/lib/positionClock";
import { useLivePosition } from "@/lib/useLivePosition";

export type KaraokeSize = "phone" | "tv";

export interface KaraokeViewProps {
  lines: LrcLine[];
  wordTimings?: LyricsWordTimings | null;
  positionSeconds: number;
  offsetMs?: number;
  clock?: PositionClock | null;
  playerPosition?: PlayerPositionReader | null;
  durationSeconds?: number;
  size: KaraokeSize;
}

const SUNG_COLOR = "#38bdf8";
const CURRENT_COLOR = "#f4f4f6";
const NEXT_COLOR = "#8a8a94";
const MIN_FIT_SCALE = 0.45;
const FIT_STEP = 0.05;

const SLOT_FONT: Record<KaraokeSize, string> = {
  phone: "clamp(1.45rem, 6.4vw, 2.6rem)",
  tv: "clamp(2.4rem, 4.8vw, 6rem)",
};

function overflows(element: HTMLElement, box: HTMLElement): boolean {
  return element.scrollHeight > box.clientHeight + 1 || element.scrollWidth > box.clientWidth + 1;
}

function fitText(text: HTMLElement, box: HTMLElement): void {
  let scale = 1;
  text.style.fontSize = "1em";
  while (scale > MIN_FIT_SCALE && overflows(text, box)) {
    scale -= FIT_STEP;
    text.style.fontSize = `${scale}em`;
  }
}

function useFitToBox(content: string) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    fitText(text, box);
    const observer = new ResizeObserver(() => fitText(text, box));
    observer.observe(box);
    return () => observer.disconnect();
  }, [content]);

  return { boxRef, textRef };
}

function Word({ text, fill, direction, color }: { text: string; fill: number; direction: "rtl" | "ltr"; color: string }) {
  return (
    <span className="whitespace-nowrap" style={fillStyle(fill, direction, SUNG_COLOR, color) as CSSProperties}>
      {text}
    </span>
  );
}

function SlotLine({ line, role, time }: { line: KaraokeLine; role: SlotContent["role"]; time: number }) {
  const { boxRef, textRef } = useFitToBox(line.text);
  const direction = lineDirection(line.text);
  const fills = lineFills(line, time);
  const color = role === "current" ? CURRENT_COLOR : NEXT_COLOR;

  return (
    <div ref={boxRef} className="h-full w-full flex items-center justify-center overflow-hidden">
      <p ref={textRef} dir={direction} className="max-w-full text-center font-bold leading-[1.25] break-normal">
        {line.words.map((word, i) => (
          <span key={i}>
            {i > 0 && " "}
            <Word text={word.text} fill={fills[i]} direction={wordDirection(word.text, direction)} color={color} />
          </span>
        ))}
      </p>
    </div>
  );
}

function Slot({ content, lines, time }: { content: SlotContent | null; lines: KaraokeLine[]; time: number }) {
  return (
    <div className="h-[2.7em] w-full shrink-0">
      {content && (
        <SlotLine key={content.lineIndex} line={lines[content.lineIndex]} role={content.role} time={time} />
      )}
    </div>
  );
}

function Countdown({ dots }: { dots: number | null }) {
  return (
    <div className="h-[0.9em] flex items-center justify-center gap-[0.35em]" aria-hidden>
      {Array.from({ length: COUNTDOWN_DOTS }, (_, i) => (
        <span
          key={i}
          className="h-[0.3em] w-[0.3em] rounded-full bg-sky-400 transition-opacity duration-150"
          style={{ opacity: dots !== null && i < dots ? 1 : 0 }}
        />
      ))}
    </div>
  );
}

export function KaraokeView({
  lines,
  wordTimings,
  positionSeconds,
  offsetMs = 0,
  clock = null,
  playerPosition = null,
  durationSeconds,
  size,
}: KaraokeViewProps) {
  const karaokeLines = useMemo(
    () => buildKaraokeLines(lines, wordTimings, durationSeconds),
    [lines, wordTimings, durationSeconds],
  );
  const position = useLivePosition({ clock, reader: playerPosition, fallbackSeconds: positionSeconds, durationSeconds });
  const sungAt = fillTime(position, offsetMs);
  const [upper, lower] = slotContents(karaokeLines, lyricsTime(position, offsetMs));

  return (
    <div className="flex-1 min-h-0 flex flex-col items-stretch justify-center" style={{ fontSize: SLOT_FONT[size] }}>
      <Countdown dots={countdownDots(karaokeLines, sungAt)} />
      <Slot content={upper} lines={karaokeLines} time={sungAt} />
      <div className="h-[0.35em] shrink-0" />
      <Slot content={lower} lines={karaokeLines} time={sungAt} />
    </div>
  );
}
