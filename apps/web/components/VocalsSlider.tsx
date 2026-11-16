"use client";

// Shared vocals volume for the current song, shown to the host and to the song's requester.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { VocalsGainBody } from "@karaoke/shared";
import { api } from "@/lib/api";
import { createLatestSender, type LatestSender } from "@/lib/latestSender";
import {
  VOCALS_SEND_INTERVAL_MS,
  VOCALS_SETTLE_MS,
  acceptsServerGain,
  vocalsUnavailableText,
  vocalsValueText,
  type LocalSend,
} from "@/lib/vocalsSlider";

interface VocalsSliderProps {
  queueItemId: string;
  hasVocals: boolean;
  serverGain: number;
  failed?: boolean;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function useGainSender(queueItemId: string, onFailure: () => void) {
  const lastSendRef = useRef<LocalSend | null>(null);
  const senderRef = useRef<LatestSender<number> | null>(null);
  const onFailureRef = useLatest(onFailure);

  useEffect(() => {
    const sender = createLatestSender((gain: number) => {
      lastSendRef.current = { gain, atMs: Date.now() };
      const body: VocalsGainBody = { gain, queueItemId };
      return api.post("/api/playback/vocals", body).catch((err) => {
        console.error(err);
        lastSendRef.current = null;
        onFailureRef.current();
      });
    }, VOCALS_SEND_INTERVAL_MS);
    senderRef.current = sender;
    return () => sender.cancel();
  }, [queueItemId, onFailureRef]);

  return { lastSendRef, senderRef };
}

function useSharedGain(queueItemId: string, serverGain: number) {
  const [value, setValue] = useState(serverGain);
  const draggingRef = useRef(false);
  const serverGainRef = useLatest(serverGain);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revert = useCallback(() => setValue(serverGainRef.current), [serverGainRef]);
  const { lastSendRef, senderRef } = useGainSender(queueItemId, revert);

  const reconcile = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
    if (acceptsServerGain(serverGainRef.current, draggingRef.current, lastSendRef.current, Date.now())) {
      setValue(serverGainRef.current);
    } else if (!draggingRef.current) {
      settleTimerRef.current = setTimeout(reconcile, VOCALS_SETTLE_MS);
    }
  }, [serverGainRef, lastSendRef]);

  useEffect(reconcile, [serverGain, reconcile]);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  const change = useCallback((gain: number) => {
    setValue(gain);
    senderRef.current?.push(gain);
  }, [senderRef]);

  const release = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    senderRef.current?.flush();
    reconcile();
  }, [senderRef, reconcile]);

  const startDrag = useCallback(() => {
    draggingRef.current = true;
    window.addEventListener("pointerup", release, { once: true });
    window.addEventListener("pointercancel", release, { once: true });
  }, [release]);

  return { value, startDrag, change, release };
}

export function VocalsSlider({ queueItemId, hasVocals, serverGain, failed = false }: VocalsSliderProps) {
  const inputId = useId();
  const hintId = useId();
  const { value, startDrag, change, release } = useSharedGain(queueItemId, serverGain);
  const unavailable = vocalsUnavailableText(hasVocals, failed);
  const shownValue = unavailable ? 0 : value;

  return (
    <div className="mt-4 rounded-2xl bg-neutral-800 border border-neutral-700 px-4 py-3">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={inputId} className="font-semibold text-neutral-200">
          Original vocals
        </label>
        <span className="tabular-nums text-neutral-400" aria-hidden="true">
          {vocalsValueText(shownValue)}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={shownValue}
        disabled={!!unavailable}
        aria-valuetext={vocalsValueText(shownValue)}
        aria-describedby={unavailable ? hintId : undefined}
        onPointerDown={startDrag}
        onChange={(e) => change(Number(e.target.value))}
        onBlur={release}
        className="w-full h-11 accent-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      />
      {unavailable && (
        <p id={hintId} className="text-xs text-neutral-500">
          {unavailable}
        </p>
      )}
    </div>
  );
}
