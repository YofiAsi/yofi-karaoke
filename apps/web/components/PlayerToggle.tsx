"use client";

// Player role: the host device claims the player, and only the player device renders <audio>.
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { PlaybackStateView, PositionBody } from "@karaoke/shared";
import { api } from "@/lib/api";
import { rememberReport, shouldSeekPlayer } from "@/lib/seekEcho";
import { vocalsGraph } from "@/lib/vocalsGraph";
import {
  VOCALS_SYNC_INTERVAL_MS,
  decideVocals,
  instrumentalSnapshot,
  vocalsActive,
  vocalsSnapshot,
  type VocalsAction,
} from "@/lib/vocalsSync";

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
}

const HEARTBEAT_MS = 10_000;
const POSITION_REPORT_MS = 1000;
const INSTRUMENTAL_EVENTS = ["play", "playing", "pause", "seeked", "waiting"] as const;
const GESTURE_EVENTS = ["click", "touchend", "keydown"] as const;
const VISIBILITY_EVENTS = ["visibilitychange"] as const;

function audioUrl(songId: string): string {
  return `/api/audio/${songId}`;
}

function vocalsUrl(songId: string): string {
  return `/api/audio/${songId}/vocals`;
}

function loadSource(el: HTMLAudioElement, url: string | null): void {
  if (!url) {
    if (el.hasAttribute("src")) {
      el.removeAttribute("src");
      el.load();
    }
    return;
  }
  if (!el.src.endsWith(url)) el.src = url;
}

function isAutoplayRejection(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

function browserDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
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

function useVisibilityWatch(audioRef: RefObject<HTMLAudioElement | null>, onVisiblePlaying: () => void) {
  const [hiddenWhilePlaying, setHiddenWhilePlaying] = useState(false);

  useEffect(() => {
    function onVisibilityChange() {
      const playing = !!audioRef.current && !audioRef.current.paused;
      setHiddenWhilePlaying(document.hidden && playing);
      if (!document.hidden && playing) onVisiblePlaying();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [audioRef, onVisiblePlaying]);

  return hiddenWhilePlaying;
}

function usePositionReports(
  audioRef: RefObject<HTMLAudioElement | null>,
  loadedItemIdRef: RefObject<string | null>,
  recentReportsRef: MutableRefObject<number[]>,
): void {
  useEffect(() => {
    const id = setInterval(() => {
      const el = audioRef.current;
      const queueItemId = loadedItemIdRef.current;
      if (!el || el.paused || !queueItemId) return;
      const report: PositionBody = { queueItemId, positionSeconds: el.currentTime };
      recentReportsRef.current = rememberReport(recentReportsRef.current, report.positionSeconds);
      api.post("/api/playback/position", report).catch(console.error);
    }, POSITION_REPORT_MS);
    return () => clearInterval(id);
  }, [audioRef, loadedItemIdRef, recentReportsRef]);
}

function useListeners(target: EventTarget | null, events: readonly string[], listener: () => void): void {
  useEffect(() => {
    if (!target) return;
    events.forEach((name) => target.addEventListener(name, listener));
    return () => events.forEach((name) => target.removeEventListener(name, listener));
  }, [target, events, listener]);
}

function useVocalsGain(vocalsRef: RefObject<HTMLAudioElement | null>, gain: number): void {
  useEffect(() => vocalsGraph.setGain(gain), [gain]);

  useEffect(() => {
    const el = vocalsRef.current;
    return () => {
      if (el) vocalsGraph.detach(el);
    };
  }, [vocalsRef]);
}

function applyVocalsAction(
  action: VocalsAction,
  instrumental: HTMLAudioElement,
  vocals: HTMLAudioElement,
): Promise<void> {
  if (action === "pause") vocals.pause();
  if (action === "resync" || action === "start") vocals.currentTime = instrumental.currentTime;
  return action === "start" ? vocals.play() : Promise.resolve();
}

interface VocalsInput {
  songId: string | null;
  hasVocals: boolean;
  gain: number;
}

function useVocals(
  instrumentalRef: RefObject<HTMLAudioElement | null>,
  vocalsRef: RefObject<HTMLAudioElement | null>,
  { songId, hasVocals, gain }: VocalsInput,
) {
  useVocalsGain(vocalsRef, gain);
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const [instrumental, setInstrumental] = useState<HTMLAudioElement | null>(null);
  const active = vocalsActive(gain, hasVocals);

  useEffect(() => setInstrumental(instrumentalRef.current), [instrumentalRef]);

  useEffect(() => {
    const el = vocalsRef.current;
    if (el) loadSource(el, songId && hasVocals ? vocalsUrl(songId) : null);
  }, [vocalsRef, songId, hasVocals]);

  const markBlocked = useCallback((value: boolean) => {
    blockedRef.current = value;
    setBlocked(value);
  }, []);

  const sync = useCallback(() => {
    const master = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (!master || !vocals) return;
    if (active && !vocalsGraph.attach(vocals)) return;
    const action = decideVocals(active, instrumentalSnapshot(master), vocalsSnapshot(vocals));
    if (action === "start" && blockedRef.current) return;
    applyVocalsAction(action, master, vocals).catch((err) => {
      if (isAutoplayRejection(err)) markBlocked(true);
    });
  }, [instrumentalRef, vocalsRef, active, markBlocked]);

  const unlock = useCallback(() => {
    vocalsGraph.resume();
    markBlocked(false);
    sync();
  }, [markBlocked, sync]);

  const resumeWhenVisible = useCallback(() => {
    if (!document.hidden) vocalsGraph.resume();
  }, []);

  useEffect(() => {
    sync();
    const id = setInterval(sync, VOCALS_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sync]);

  useListeners(instrumental, INSTRUMENTAL_EVENTS, sync);
  useListeners(browserDocument(), GESTURE_EVENTS, unlock);
  useListeners(browserDocument(), VISIBILITY_EVENTS, resumeWhenVisible);

  return { blocked: blocked && active, unlock };
}

function PlayerAudio({
  source,
  playbackState,
  onTick,
}: Omit<PlayerToggleProps, "isHost" | "isPlayer">) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const vocalsRef = useRef<HTMLAudioElement>(null);
  const loadedItemIdRef = useRef<string | null>(null);
  const recentReportsRef = useRef<number[]>([]);
  const [blocked, setBlocked] = useState(false);
  const { acquire: acquireWake, release: releaseWake } = useWakeLock();
  const hiddenWhilePlaying = useVisibilityWatch(audioRef, acquireWake);
  usePositionReports(audioRef, loadedItemIdRef, recentReportsRef);

  const audioSongId = source?.songId ?? null;
  const loadedItemId = source?.queueItemId ?? null;
  const isPlaying = playbackState?.isPlaying ?? false;
  const positionSeconds = playbackState?.positionSeconds ?? 0;
  const { blocked: vocalsBlocked, unlock: unlockVocals } = useVocals(audioRef, vocalsRef, {
    songId: audioSongId,
    hasVocals: source?.hasVocals ?? false,
    gain: playbackState?.vocalsGain ?? 0,
  });

  const startAudio = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    unlockVocals();
    try {
      await el.play();
      setBlocked(false);
      void acquireWake();
    } catch {
      setBlocked(true);
    }
  }, [acquireWake, unlockVocals]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    loadedItemIdRef.current = loadedItemId;
    recentReportsRef.current = [];
    loadSource(el, audioSongId ? audioUrl(audioSongId) : null);
  }, [audioSongId, loadedItemId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying && audioSongId && el.paused) void startAudio();
    if (!isPlaying && !el.paused) {
      el.pause();
      releaseWake();
    }
  }, [isPlaying, audioSongId, startAudio, releaseWake]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (shouldSeekPlayer(el.currentTime, positionSeconds, recentReportsRef.current)) {
      el.currentTime = positionSeconds;
    }
  }, [positionSeconds]);

  function reportEnded() {
    const expectedQueueItemId = loadedItemIdRef.current;
    if (!expectedQueueItemId) return;
    api.post("/api/playback/ended", { expectedQueueItemId }).catch(console.error);
  }

  return (
    <div className="mt-4">
      <audio
        ref={audioRef}
        preload="metadata"
        playsInline
        onEnded={reportEnded}
        onTimeUpdate={(e) => onTick?.(e.currentTarget.currentTime)}
      />
      <audio ref={vocalsRef} preload="none" playsInline />
      {hiddenWhilePlaying ? (
        <p className="text-xs text-amber-400/90 mb-2 px-1">
          This tab is in the background, so iOS may pause audio. Keep the screen on and the
          tab visible while hosting playback.
        </p>
      ) : null}
      {(blocked || vocalsBlocked) && audioSongId ? (
        <button
          type="button"
          onClick={startAudio}
          className="w-full rounded-xl bg-white text-black py-4 font-semibold min-h-12"
        >
          ▶ Tap to start audio
        </button>
      ) : null}
    </div>
  );
}

export function PlayerToggle({ isHost, isPlayer, ...audioProps }: PlayerToggleProps) {
  usePlayerClaim(isHost);
  return isPlayer ? <PlayerAudio {...audioProps} /> : null;
}
