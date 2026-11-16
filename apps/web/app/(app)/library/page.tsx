"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Song } from "@karaoke/shared";
import { api } from "@/lib/api";
import { addSongErrorMessage, isAlreadyQueued } from "@/lib/addSongError";
import { formatDuration } from "@/lib/formatDuration";
import { useAppShell } from "../AppShellContext";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

interface LibraryResponse {
  items: Song[];
  total: number;
}

function libraryUrl(query: string, offset: number): string {
  const q = query.trim();
  return `/api/library?limit=${PAGE_SIZE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
}

function useLibrarySearch(query: string) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<LibraryResponse>(libraryUrl(query, 0));
        if (cancelled) return;
        setSongs(data.items);
        setTotal(data.total);
        setError(null);
      } catch {
        if (!cancelled) setError("Failed to load library.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await api.get<LibraryResponse>(libraryUrl(query, songs.length));
      setSongs((prev) => [...prev, ...data.items]);
      setTotal(data.total);
    } catch {
      setError("Failed to load more songs.");
    } finally {
      setLoadingMore(false);
    }
  }

  return { songs, total, loading, loadingMore, error, loadMore };
}

interface SongRowProps {
  song: Song;
  submitting: boolean;
  added: boolean;
  onAdd: () => void;
}

function SongRow({ song, submitting, added, onAdd }: SongRowProps) {
  return (
    <li className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-center gap-3">
      {song.thumbnailUrl ? (
        <img src={song.thumbnailUrl} alt="" className="h-16 w-16 rounded-md object-cover bg-neutral-800 flex-shrink-0" />
      ) : (
        <div className="h-16 w-16 rounded-md bg-neutral-800 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p dir="auto" className="font-medium line-clamp-2 text-start">
          {song.title}
        </p>
        <p className="text-xs text-neutral-400 truncate">
          <bdi>{song.artist}</bdi> · {formatDuration(song.durationSeconds)}
        </p>
        {song.hasLyrics && <p className="text-xs text-neutral-600 mt-0.5">Lyrics</p>}
      </div>
      <button
        onClick={onAdd}
        disabled={submitting || added}
        className="rounded-full bg-white text-black px-3 py-2 text-xs font-semibold disabled:opacity-40 flex-shrink-0"
      >
        {submitting ? "Adding…" : added ? "Added" : "Add"}
      </button>
    </li>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const { user, isHost } = useAppShell();
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const library = useLibrarySearch(query);

  function markAdded(songId: string) {
    setAdded((prev) => new Set(prev).add(songId));
    router.push("/");
  }

  async function requeue(song: Song) {
    setSubmitting(song.id);
    setAddError(null);
    try {
      await api.post(`/api/library/${song.id}/requeue`);
      markAdded(song.id);
    } catch (err) {
      if (isAlreadyQueued(err)) markAdded(song.id);
      else setAddError(addSongErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  if (!user) return null;

  const { songs, total, loading, loadingMore, error } = library;
  const hasMore = songs.length < total;

  return (
    <main className="min-h-screen p-5 flex flex-col gap-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-neutral-400 text-sm">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Library</h1>
        {isHost && (
          <Link href="/tv" className="ms-auto text-sm text-neutral-300 underline underline-offset-4">
            TV screen
          </Link>
        )}
      </header>
      <p className="text-sm text-neutral-500 -mt-3">Songs here are already processed and ready to sing right away.</p>

      <input
        autoFocus
        dir="auto"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or artist…"
        className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500 text-start"
      />

      {(addError ?? error) && (
        <p role="alert" className="text-sm text-red-400">
          {addError ?? error}
        </p>
      )}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {!loading && songs.length === 0 && (
        <p className="text-neutral-500 text-center py-10">
          {query ? "No songs match that search." : "No songs in library yet."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {songs.map((song) => (
          <SongRow
            key={song.id}
            song={song}
            submitting={submitting === song.id}
            added={added.has(song.id)}
            onAdd={() => requeue(song)}
          />
        ))}
      </ul>

      {hasMore && !loading && (
        <button
          onClick={library.loadMore}
          disabled={loadingMore}
          className="w-full rounded-xl border border-neutral-700 py-3 text-sm text-neutral-400 disabled:opacity-40"
        >
          {loadingMore ? "Loading…" : `Load more (${total - songs.length} remaining)`}
        </button>
      )}
    </main>
  );
}
