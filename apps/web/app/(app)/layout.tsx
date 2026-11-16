"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  QueueView,
  PlaybackStateView,
  SongProgressEvent,
  PlaybackTickEvent,
  User,
} from "@karaoke/shared";
import { api } from "@/lib/api";
import { nameUrlFor } from "@/lib/returnPath";
import { loadStoredUser, validateStoredUser } from "@/lib/user";
import { isCurrentHost, isPlayerDevice } from "@/lib/roles";
import { withTick } from "@/lib/playbackTick";
import { clockForItem, lyricsPositionFor, type PlayerTick } from "@/lib/lyricsPosition";
import { readerForItem, type PlayerPositionReader } from "@/lib/livePosition";
import { usePositionClock } from "@/lib/usePositionClock";
import { useSocket } from "@/lib/socket";
import { NOT_LOADED, lyricsFromResponse, noLyricsFor, shownLyrics, type LyricsResponse, type SongLyrics } from "@/lib/songLyrics";
import { PlayerToggle } from "@/components/PlayerToggle";
import { AppShellContext } from "./AppShellContext";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const socket = useSocket();
  const [user, setUser] = useState<User | null>(null);
  const [userChecked, setUserChecked] = useState(false);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackStateView | null>(null);
  const [lastTick, setLastTick] = useState<PlaybackTickEvent | null>(null);
  const [progress, setProgress] = useState<Map<string, SongProgressEvent>>(() => new Map());
  const [songLyrics, setSongLyrics] = useState<SongLyrics>(NOT_LOADED);
  const [playerReader, setPlayerReader] = useState<PlayerPositionReader | null>(null);
  const [playerTick, setPlayerTick] = useState<PlayerTick | null>(null);
  const [lyricsVersion, setLyricsVersion] = useState(0);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);
  const clock = usePositionClock();
  const [failedVocalsSongId, setFailedVocalsSongId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUser(loadStoredUser());
    validateStoredUser().then((validated) => {
      if (cancelled) return;
      setUser(validated);
      setUserChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (userChecked && !user) {
      router.replace(nameUrlFor(window.location.pathname));
    }
  }, [user, userChecked, router]);

  const fetchQueue = useCallback(async () => {
    try {
      setQueue(await api.get<QueueView>("/api/queue"));
    } catch { /* ignore */ }
  }, []);

  const { onState: clockOnState, onTick: clockOnTick } = clock;

  const applyPlaybackState = useCallback((data: PlaybackStateView) => {
    setPlaybackState(data);
    setLastTick(null);
    clockOnState(data);
  }, [clockOnState]);

  const fetchPlaybackState = useCallback(async () => {
    try {
      applyPlaybackState(await api.get<PlaybackStateView>("/api/playback"));
    } catch { /* ignore */ }
  }, [applyPlaybackState]);

  useEffect(() => {
    if (!user) return;
    fetchQueue();
    fetchPlaybackState();

    function onQueueUpdated() {
      fetchQueue();
      setLyricsVersion((v) => v + 1);
    }
    function onPlaybackState(data: PlaybackStateView) {
      applyPlaybackState(data);
    }
    function onSongProgress(data: SongProgressEvent) {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(data.songId, data);
        return next;
      });
    }
    function onHostOrPlayerChanged() { fetchPlaybackState(); }
    function onReconnect() {
      fetchQueue();
      fetchPlaybackState();
    }
    function onPlaybackTick(data: PlaybackTickEvent) {
      setLastTick(data);
      clockOnTick(data);
    }

    socket.on("queue:updated", onQueueUpdated);
    socket.on("playback:state", onPlaybackState);
    socket.on("playback:tick", onPlaybackTick);
    socket.on("song:progress", onSongProgress);
    socket.on("host:changed", onHostOrPlayerChanged);
    socket.on("player:changed", onHostOrPlayerChanged);
    socket.io.on("reconnect", onReconnect);

    return () => {
      socket.off("queue:updated", onQueueUpdated);
      socket.off("playback:state", onPlaybackState);
      socket.off("playback:tick", onPlaybackTick);
      socket.off("song:progress", onSongProgress);
      socket.off("host:changed", onHostOrPlayerChanged);
      socket.off("player:changed", onHostOrPlayerChanged);
      socket.io.off("reconnect", onReconnect);
    };
  }, [user, socket, fetchQueue, fetchPlaybackState, applyPlaybackState, clockOnTick]);

  const isHost = isCurrentHost(user, playbackState);
  const isPlayer = isPlayerDevice(user, playbackState);
  const displayedPlayback = withTick(playbackState, lastTick);

  useEffect(() => {
    if (!isPlayer) setPlayerTick(null);
  }, [isPlayer]);

  const onPlayerTick = useCallback((seconds: number, queueItemId: string) => {
    setPlayerTick({ queueItemId, seconds });
  }, []);

  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      api.post("/api/users/heartbeat").catch(console.error);
    }, 10_000);
    return () => clearInterval(id);
  }, [isHost]);

  const currentSong = queue?.current?.song ?? null;

  useEffect(() => {
    const songId = currentSong?.id ?? null;
    if (!songId || !currentSong?.hasLyrics) {
      setSongLyrics(noLyricsFor(songId));
      setLyricsOffsetMs(0);
      return;
    }
    let cancelled = false;
    api
      .get<LyricsResponse>(`/api/songs/${songId}/lyrics`)
      .then((res) => {
        if (cancelled) return;
        setSongLyrics(lyricsFromResponse(songId, res));
        setLyricsOffsetMs(res.offsetMs ?? 0);
      })
      .catch(() => {
        if (!cancelled) setSongLyrics(noLyricsFor(songId));
      });
    return () => {
      cancelled = true;
    };
  }, [currentSong?.id, currentSong?.hasLyrics, lyricsVersion]);

  const lyrics = shownLyrics(songLyrics, currentSong?.id ?? null);
  const current = queue?.current ?? null;
  const currentItemId = current?.id ?? null;
  const lyricsPosition = lyricsPositionFor(currentItemId, isPlayer ? playerTick : null, displayedPlayback);
  const audioSource = current?.song.hasInstrumental
    ? { queueItemId: current.id, songId: current.song.id, hasVocals: current.song.hasVocals }
    : null;

  if (!user) return null;

  return (
    <AppShellContext.Provider
      value={{
        user,
        isHost,
        queue,
        playbackState: displayedPlayback,
        progress,
        lrcLines: lyrics.lines,
        plainLyrics: lyrics.plain,
        wordTimings: lyrics.wordTimings,
        lyricsLoading: lyrics.loading,
        lyricsOffsetMs,
        lyricsSource: lyrics.source,
        setLyricsOffsetMs,
        lyricsPosition,
        refetchQueue: fetchQueue,
        positionClock: isPlayer ? null : clockForItem(currentItemId, clock.clock),
        playerPosition: isPlayer ? readerForItem(currentItemId, playerReader) : null,
        failedVocalsSongId,
      }}
    >
      <PlayerToggle
        isHost={isHost}
        isPlayer={isPlayer}
        source={audioSource}
        playbackState={playbackState}
        onTick={onPlayerTick}
        onVocalsFailed={setFailedVocalsSongId}
        onPositionReader={setPlayerReader}
      />
      {children}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-md px-4 pt-2 flex justify-center"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
        aria-label="Primary"
      >
        <Link
          href="/search"
          className="w-full max-w-md rounded-2xl bg-white text-black py-3.5 text-center text-base font-semibold min-h-12 flex items-center justify-center active:opacity-90"
        >
          Add a song
        </Link>
      </nav>
    </AppShellContext.Provider>
  );
}
