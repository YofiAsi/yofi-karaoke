"use client";

// Owns the stem engine for the player device: one shared AudioContext, per song loading, and the context run state.
import { useCallback, useEffect, useRef, useState } from "react";
import { StemPlayer, fetchStem, sharedAudioContext } from "./stemPlayer";

export interface StemSource {
  queueItemId: string;
  songId: string;
  hasVocals: boolean;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";

interface LoadState {
  queueItemId: string | null;
  status: LoadStatus;
}

interface StemCallbacks {
  onEnded: (queueItemId: string) => void;
  onVocalsFailed?: (songId: string) => void;
}

const IDLE: LoadState = { queueItemId: null, status: "idle" };

function instrumentalUrl(songId: string): string {
  return `/api/audio/${songId}`;
}

function vocalsUrl(songId: string): string {
  return `/api/audio/${songId}/vocals`;
}

function useEngine() {
  const [engine, setEngine] = useState<StemPlayer | null>(null);
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    const audioCtx = sharedAudioContext();
    if (!audioCtx) return;
    const created = new StemPlayer(audioCtx);
    setCtx(audioCtx);
    setEngine(created);
    return () => {
      created.dispose();
      setEngine(null);
    };
  }, []);

  return { ctx, engine };
}

function useContextState(ctx: AudioContext | null): string {
  const [state, setState] = useState<string>("suspended");

  useEffect(() => {
    if (!ctx) return;
    const update = () => setState(ctx.state);
    update();
    ctx.addEventListener("statechange", update);
    return () => ctx.removeEventListener("statechange", update);
  }, [ctx]);

  return state;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

interface LoadJob {
  ctx: AudioContext;
  engine: StemPlayer;
  source: StemSource;
  signal: AbortSignal;
  setLoad: (state: LoadState) => void;
  callbacks: { current: StemCallbacks };
}

function startLoad({ ctx, engine, source, signal, setLoad, callbacks }: LoadJob): void {
  const { queueItemId, songId, hasVocals } = source;
  let pendingVocals: AudioBuffer | null = null;
  setLoad({ queueItemId, status: "loading" });
  engine.onEnded = () => callbacks.current.onEnded(queueItemId);

  fetchStem(ctx, instrumentalUrl(songId), signal)
    .then((buffer) => {
      if (signal.aborted) return;
      engine.load(buffer);
      if (pendingVocals) engine.addVocals(pendingVocals);
      pendingVocals = null;
      setLoad({ queueItemId, status: "ready" });
    })
    .catch((err) => {
      if (signal.aborted) return;
      console.error("instrumental failed to load", err);
      setLoad({ queueItemId, status: "error" });
    });

  if (!hasVocals) return;
  fetchStem(ctx, vocalsUrl(songId), signal)
    .then((buffer) => {
      if (signal.aborted) return;
      if (engine.isLoaded()) engine.addVocals(buffer);
      else pendingVocals = buffer;
    })
    .catch((err) => {
      if (signal.aborted) return;
      console.error("vocals failed to load", err);
      callbacks.current.onVocalsFailed?.(songId);
    });
}

export function useStemPlayer(source: StemSource | null, callbacks: StemCallbacks) {
  const { ctx, engine } = useEngine();
  const contextState = useContextState(ctx);
  const [load, setLoad] = useState<LoadState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const callbacksRef = useLatest(callbacks);
  const queueItemId = source?.queueItemId ?? null;
  const songId = source?.songId ?? null;
  const hasVocals = source?.hasVocals ?? false;

  useEffect(() => {
    if (!ctx || !engine) return;
    if (!queueItemId || !songId) {
      engine.unload();
      setLoad(IDLE);
      return;
    }
    const controller = new AbortController();
    const job = { queueItemId, songId, hasVocals };
    startLoad({ ctx, engine, source: job, signal: controller.signal, setLoad, callbacks: callbacksRef });
    return () => {
      controller.abort();
      engine.onEnded = null;
      engine.unload();
    };
  }, [ctx, engine, queueItemId, songId, hasVocals, attempt, callbacksRef]);

  const resume = useCallback(() => {
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => undefined);
  }, [ctx]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const current = load.queueItemId === queueItemId;
  const status: LoadStatus = current ? load.status : queueItemId ? "loading" : "idle";

  return { engine, status, running: contextState === "running", resume, retry };
}
