"use client";

// Player role: the host device claims the player, and only the player device plays the song's stems.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { PlaybackStateView, PositionBody } from "@karaoke/shared";
import { api } from "@/lib/api";
import { rememberReport, shouldSeekPlayer } from "@/lib/seekEcho";
import type { StemPlayer } from "@/lib/stemPlayer";
import { useStemPlayer, type LoadStatus, type StemSource } from "@/lib/useStemPlayer";

export interface AudioSource {
  queueItemId: string;
  songId: string;
  hasVocals?: boolean;
}

interface PlayerToggleProps {
  isHost: boolean;
  isPlayer: boolean;
  source: AudioSource | null;
  playbackState: PlaybackStateView | null;
  onTick?: (positionSeconds: number) => void;
  onVocalsFailed?: (songId: string) => void;
}

const HEARTBEAT_MS = 10_000;
const POSITION_REPORT_MS = 1000;
const TICK_MS = 200;
const GESTURE_EVENTS = ["click", "touchend", "keydown"] as const;

function stateForLoadedItem(
  playbackState: PlaybackStateView | null,
  loadedItemId: string | null,
): PlaybackStateView | null {
  if (!playbackState || !loadedItemId || playbackState.currentQueueItemId !== loadedItemId) return null;
  return playbackState;
}

function toStemSource(source: AudioSource | null): StemSource | null {
  return source ? { ...source, hasVocals: source.hasVocals ?? false } : null;
}

function usePlayerClaim(isHost: boolean): void {
  useEffect(() => {
    if (!isHost) return;
    api.post("/api/player/claim").catch(console.error);
    const id = setInterval(() => {
      api.post("/api/player/heartbeat").catch(console.error);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      api.post("/api/player/release").catch(console.error);
    };
  }, [isHost]);
}

function useWakeLock() {
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const release = useCallback(() => {
    const lock = wakeRef.current;
    wakeRef.current = null;
    void lock?.release();
  }, []);

  const acquire = useCallback(async () => {
    if (!("wakeLock" in navigator) || !navigator.wakeLock) return;
    try {
      release();
      const lock = await navigator.wakeLock.request("screen");
      wakeRef.current = lock;
      lock.addEventListener("release", () => {
        if (wakeRef.current === lock) wakeRef.current = null;
      });
    } catch {
      wakeRef.current = null;
    }
  }, [release]);

  useEffect(() => release, [release]);

  return { acquire, release };
}

function useVisibilityWatch(isAudible: () => boolean, onVisible: () => void) {
  const [hiddenWhilePlaying, setHiddenWhilePlaying] = useState(false);

  useEffect(() => {
    function onVisibilityChange() {
      setHiddenWhilePlaying(document.hidden && isAudible());
      if (!document.hidden) onVisible();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isAudible, onVisible]);

  return hiddenWhilePlaying;
}

function useGestureResume(resume: () => void): void {
  useEffect(() => {
    GESTURE_EVENTS.forEach((name) => document.addEventListener(name, resume));
    return () => GESTURE_EVENTS.forEach((name) => document.removeEventListener(name, resume));
  }, [resume]);
}

function usePositionReports(
  isAudible: () => boolean,
  engine: StemPlayer | null,
  loadedItemId: string | null,
  recentReportsRef: MutableRefObject<number[]>,
): void {
  useEffect(() => {
    if (!engine || !loadedItemId) return;
    const id = setInterval(() => {
      if (!isAudible()) return;
      const report: PositionBody = { queueItemId: loadedItemId, positionSeconds: engine.position() };
      recentReportsRef.current = rememberReport(recentReportsRef.current, report.positionSeconds);
      api.post("/api/playback/position", report).catch(console.error);
    }, POSITION_REPORT_MS);
    return () => clearInterval(id);
  }, [isAudible, engine, loadedItemId, recentReportsRef]);
}

function usePositionTicks(engine: StemPlayer | null, ready: boolean, onTick?: (seconds: number) => void) {
  const lastRef = useRef<number | null>(null);

  const emit = useCallback(() => {
    if (!engine || !ready || !onTick) return;
    const position = engine.position();
    if (position === lastRef.current) return;
    lastRef.current = position;
    onTick(position);
  }, [engine, ready, onTick]);

  useEffect(() => {
    lastRef.current = null;
    emit();
    const id = setInterval(emit, TICK_MS);
    return () => clearInterval(id);
  }, [emit]);

  return emit;
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function reportEnded(expectedQueueItemId: string): void {
  api.post("/api/playback/ended", { expectedQueueItemId }).catch(console.error);
}

const NOTICE_CLASS = "rounded-xl bg-neutral-900/95 border text-xs px-3 py-2";

function LoadNotice({ status, onRetry }: { status: LoadStatus; onRetry: () => void }) {
  if (status === "loading") {
    return <p className={`${NOTICE_CLASS} self-center border-neutral-700 text-neutral-300`}>Loading audio…</p>;
  }
  if (status !== "error") return null;
  return (
    <div className={`${NOTICE_CLASS} border-red-400/40 text-red-300 flex items-center justify-between gap-3`}>
      <span>Could not load this song&apos;s audio.</span>
      <button type="button" onClick={onRetry} className="rounded-lg bg-white text-black px-3 py-1 font-semibold">
        Retry
      </button>
    </div>
  );
}

function PlayerNotices({
  hiddenWhilePlaying,
  showStart,
  onStart,
  status,
  onRetry,
}: {
  hiddenWhilePlaying: boolean;
  showStart: boolean;
  onStart: () => void;
  status: LoadStatus;
  onRetry: () => void;
}) {
  const showLoad = status === "loading" || status === "error";
  if (!hiddenWhilePlaying && !showStart && !showLoad) return null;
  return (
    <div
      className="fixed inset-x-4 z-[200] flex flex-col gap-2"
      style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
    >
      {hiddenWhilePlaying ? (
        <p className={`${NOTICE_CLASS} border-amber-400/40 text-amber-400/90`}>
          This tab is in the background, so iOS may pause audio. Keep the screen on and the
          tab visible while hosting playback.
        </p>
      ) : null}
      {showStart ? (
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-xl bg-white text-black py-4 font-semibold min-h-12 shadow-lg"
        >
          ▶ Tap to start audio
        </button>
      ) : null}
      <LoadNotice status={status} onRetry={onRetry} />
    </div>
  );
}

function PlayerAudio({
  source,
  playbackState,
  onTick,
  onVocalsFailed,
}: Omit<PlayerToggleProps, "isHost" | "isPlayer">) {
  const recentReportsRef = useRef<number[]>([]);
  const loadedItemId = source?.queueItemId ?? null;
  const { engine, status, running, resume, retry } = useStemPlayer(toStemSource(source), {
    onEnded: reportEnded,
    onVocalsFailed,
  });
  const loadedState = stateForLoadedItem(playbackState, loadedItemId);
  const ready = status === "ready" && !!engine;
  const isPlaying = loadedState?.isPlaying ?? false;
  const isPlayingRef = useLatestRef(isPlaying);
  const hasLoadedState = loadedState !== null;
  const positionSeconds = loadedState?.positionSeconds ?? 0;
  const gain = loadedState?.vocalsGain ?? 0;
  const { acquire: acquireWake, release: releaseWake } = useWakeLock();
  const emitTick = usePositionTicks(engine, ready, onTick);

  const isAudible = useCallback(() => running && !!engine?.isPlaying(), [running, engine]);
  const onVisible = useCallback(() => {
    resume();
    if (isAudible()) void acquireWake();
  }, [resume, isAudible, acquireWake]);
  const hiddenWhilePlaying = useVisibilityWatch(isAudible, onVisible);
  useGestureResume(resume);
  usePositionReports(isAudible, engine, loadedItemId, recentReportsRef);

  useEffect(() => {
    recentReportsRef.current = [];
  }, [loadedItemId]);

  useEffect(() => engine?.setVocalsGain(gain), [engine, gain]);

  useEffect(() => {
    if (!ready || !engine || !hasLoadedState) return;
    if (!shouldSeekPlayer(engine.position(), positionSeconds, recentReportsRef.current)) return;
    engine.seek(positionSeconds);
    if (isPlayingRef.current) engine.play();
    emitTick();
  }, [ready, engine, hasLoadedState, positionSeconds, isPlayingRef, emitTick]);

  useEffect(() => {
    if (!ready || !engine) return;
    if (isPlaying) engine.play();
    else engine.pause();
    emitTick();
  }, [ready, engine, isPlaying, emitTick]);

  useEffect(() => {
    if (isPlaying && running) void acquireWake();
    else releaseWake();
  }, [isPlaying, running, acquireWake, releaseWake]);

  const startAudio = useCallback(() => {
    resume();
    void acquireWake();
  }, [resume, acquireWake]);

  return (
    <PlayerNotices
      hiddenWhilePlaying={hiddenWhilePlaying}
      showStart={isPlaying && !!source && !running}
      onStart={startAudio}
      status={status}
      onRetry={retry}
    />
  );
}

export function PlayerToggle({ isHost, isPlayer, ...audioProps }: PlayerToggleProps) {
  usePlayerClaim(isHost);
  return isPlayer ? <PlayerAudio {...audioProps} /> : null;
}
