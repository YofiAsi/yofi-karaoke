"use client";

// Re renders once per animation frame with the continuous playback position, and only when it changed.
import { useCallback, useEffect, useState } from "react";
import { readLivePosition, type LiveSources } from "./livePosition";

export function useLivePosition({ clock, reader, fallbackSeconds, durationSeconds }: LiveSources): number {
  const read = useCallback(
    () => readLivePosition({ clock, reader, fallbackSeconds, durationSeconds }, performance.now()),
    [clock, reader, fallbackSeconds, durationSeconds],
  );
  const [, setPosition] = useState(read);

  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      setPosition(read());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [read]);

  return read();
}
