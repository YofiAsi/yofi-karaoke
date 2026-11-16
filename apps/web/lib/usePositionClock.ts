"use client";

// Keeps the interpolation anchor for guest lyrics from playback state and tick events.
import { useCallback, useRef, useState } from "react";
import type { PlaybackStateView, PlaybackTickEvent } from "@karaoke/shared";
import { clockFromState, clockFromTick, updateClockOffset, type PositionClock } from "./positionClock";

export function usePositionClock() {
  const [clock, setClock] = useState<PositionClock | null>(null);
  const offsetRef = useRef<number | null>(null);

  const onState = useCallback((state: PlaybackStateView) => {
    const now = Date.now();
    setClock((prev) => clockFromState(prev, state, now));
  }, []);

  const onTick = useCallback((tick: PlaybackTickEvent) => {
    const offset = updateClockOffset(offsetRef.current, tick.serverTimeMs, Date.now());
    offsetRef.current = offset;
    setClock((prev) => clockFromTick(prev, tick, offset));
  }, []);

  return { clock, onState, onTick };
}
