"use client";

// Registry of selectable lyrics displays; a new display is one more entry in LYRICS_DISPLAYS.
import { useCallback, useEffect, useState, type ComponentType } from "react";
import type { LyricsWordTimings } from "@karaoke/shared";
import type { LrcLine } from "@/lib/lrc";
import type { PositionClock } from "@/lib/positionClock";
import type { PlayerPositionReader } from "@/lib/livePosition";
import { isAutomaticLyrics } from "@/lib/manualLyrics";
import {
  browserStorage,
  loadDisplayPreference,
  saveDisplayPreference,
  type DisplaySurface,
} from "@/lib/lyricsDisplayPreference";
import { AutoLyricsLabel, LyricsView } from "./LyricsView";
import { KaraokeView } from "./KaraokeView";
import { hasSungLines } from "@/lib/karaokeLines";

export interface LyricsDisplayProps {
  loading: boolean;
  lines: LrcLine[];
  wordTimings?: LyricsWordTimings | null;
  plainText?: string;
  positionSeconds: number;
  offsetMs: number;
  source?: string | null;
  clock?: PositionClock | null;
  playerPosition?: PlayerPositionReader | null;
  durationSeconds?: number;
  surface: DisplaySurface;
}

export interface LyricsDisplay {
  id: string;
  label: string;
  Component: ComponentType<LyricsDisplayProps>;
}

const TV_SCROLL_TEXT = "[&_p]:!text-[clamp(2rem,4.2vw,4.75rem)] [&_p]:!leading-tight";
const TV_LABEL_TEXT = "[&>p]:!text-[clamp(1rem,1.4vw,1.6rem)]";

function LoadingLyrics() {
  return <div className="flex-1 min-h-0" />;
}

function ScrollingLyrics(props: LyricsDisplayProps) {
  if (props.loading) return <LoadingLyrics />;
  return (
    <div className={`flex-1 min-h-0 flex flex-col ${props.surface === "tv" ? TV_SCROLL_TEXT : ""}`}>
      <LyricsView
        lines={props.lines}
        positionSeconds={props.positionSeconds}
        plainText={props.plainText}
        offsetMs={props.offsetMs}
        source={props.source}
        clock={props.clock}
        durationSeconds={props.durationSeconds}
        expandToFill
      />
    </div>
  );
}

function KaraokeLyrics(props: LyricsDisplayProps) {
  if (props.loading || !hasSungLines(props.lines)) return <ScrollingLyrics {...props} lines={[]} />;
  return (
    <div className={`flex-1 min-h-0 flex flex-col ${props.surface === "tv" ? TV_LABEL_TEXT : ""}`}>
      {isAutomaticLyrics(props.source) && <AutoLyricsLabel />}
      <KaraokeView
        lines={props.lines}
        wordTimings={props.wordTimings}
        positionSeconds={props.positionSeconds}
        offsetMs={props.offsetMs}
        clock={props.clock}
        playerPosition={props.playerPosition}
        durationSeconds={props.durationSeconds}
        size={props.surface === "tv" ? "tv" : "phone"}
      />
    </div>
  );
}

export const LYRICS_DISPLAYS: readonly LyricsDisplay[] = [
  { id: "scroll", label: "Scrolling", Component: ScrollingLyrics },
  { id: "karaoke", label: "Karaoke", Component: KaraokeLyrics },
];

const DISPLAY_IDS = LYRICS_DISPLAYS.map((display) => display.id);

export const DEFAULT_DISPLAY: Record<DisplaySurface, string> = { home: "scroll", tv: "karaoke" };

export const PENDING_DISPLAY: LyricsDisplay = { id: "pending", label: "", Component: LoadingLyrics };

export function findLyricsDisplay(id: string): LyricsDisplay {
  if (id === PENDING_DISPLAY.id) return PENDING_DISPLAY;
  return LYRICS_DISPLAYS.find((display) => display.id === id) ?? LYRICS_DISPLAYS[0];
}

export function useLyricsDisplay(surface: DisplaySurface) {
  const [id, setId] = useState(PENDING_DISPLAY.id);

  useEffect(() => {
    setId(loadDisplayPreference(browserStorage(), surface, DISPLAY_IDS, DEFAULT_DISPLAY[surface]));
  }, [surface]);

  const choose = useCallback(
    (next: string) => {
      setId(next);
      saveDisplayPreference(browserStorage(), surface, next);
    },
    [surface],
  );

  return { display: findLyricsDisplay(id), choose };
}

const SWITCH_BUTTON_SIZE = {
  phone: "min-h-11 px-4 text-sm",
  tv: "min-h-8 px-3 py-1.5 text-xs",
};

export function LyricsDisplaySwitch({
  selectedId,
  onChoose,
  size = "phone",
  className = "",
}: {
  selectedId: string;
  onChoose: (id: string) => void;
  size?: keyof typeof SWITCH_BUTTON_SIZE;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Lyrics display" className={`inline-flex rounded-full border border-neutral-700 p-0.5 ${className}`}>
      {LYRICS_DISPLAYS.map((display) => {
        const selected = display.id === selectedId;
        return (
          <button
            key={display.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChoose(display.id)}
            className={`rounded-full font-semibold ${SWITCH_BUTTON_SIZE[size]} ${
              selected ? "bg-white text-black" : "text-neutral-400"
            }`}
          >
            {display.label}
          </button>
        );
      })}
    </div>
  );
}
