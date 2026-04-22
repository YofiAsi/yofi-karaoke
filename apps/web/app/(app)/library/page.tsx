"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Song } from "@karaoke/shared";
import { api, ApiError } from "@/lib/api";
import { useAppShell } from "../AppShellContext";

const PAGE_SIZE = 20;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LibraryPage() {
  const router = useRouter();
  const { user } = useAppShell();
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user && !user.isHost) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (!user?.isHost) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOffset(0);
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const q = query.trim();
        const url = `/api/library?limit=${PAGE_SIZE}&offset=0${q ? `&q=${encodeURIComponent(q)}` : ""}`;
        const data = await api.get<{ items: Song[]; total: number }>(url);
        setSongs(data.items);
        setTotal(data.total);
        setError(null);
      } catch {
        setError("Failed to load library.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, user]);

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const q = query.trim();
      const url = `/api/library?limit=${PAGE_SIZE}&offset=${nextOffset}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
      const data = await api.get<{ items: Song[]; total: number }>(url);
      setSongs((prev) => [...prev, ...data.items]);
      setTotal(data.total);
      setOffset(nextOffset);
    } catch {
      setError("Failed to load more songs.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function requeue(song: Song) {
    setSubmitting(song.id);
    setError(null);
    try {
      await api.post(`/api/library/${song.id}/requeue`);
      setAdded((prev) => new Set(prev).add(song.id));
      router.push("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAdded((prev) => new Set(prev).add(song.id));
        router.push("/");
      } else {
        setError("Could not add to queue.");
      }
    } finally {
      setSubmitting(null);
    }
  }

  if (!user) return null;
  if (!user.isHost) return null;

  const hasMore = songs.length < total;

  return (
    <main className="min-h-screen p-5 flex flex-col gap-5 pb-20">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-neutral-400 text-sm">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Library</h1>
      </header>

      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or artist…"
        className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {!loading && songs.length === 0 && (
        <p className="text-neutral-500 text-center py-10">
          {query ? "No songs match that search." : "No songs in library yet."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {songs.map((song) => (
          <li
            key={song.id}
            className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-center gap-3"
          >
            {song.thumbnailUrl ? (
              <img
                src={song.thumbnailUrl}
                alt=""
                className="h-16 w-16 rounded-md object-cover bg-neutral-800 flex-shrink-0"
              />
            ) : (
              <div className="h-16 w-16 rounded-md bg-neutral-800 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium line-clamp-2">{song.title}</p>
              <p className="text-xs text-neutral-400 truncate">
                {song.artist} · {formatDuration(song.durationSeconds)}
              </p>
              {song.hasLyrics && (
                <p className="text-xs text-neutral-600 mt-0.5">Lyrics</p>
              )}
            </div>
            <button
              onClick={() => requeue(song)}
              disabled={submitting === song.id || added.has(song.id)}
              className="rounded-full bg-white text-black px-3 py-2 text-xs font-semibold disabled:opacity-40 flex-shrink-0"
            >
              {submitting === song.id
                ? "Adding…"
                : added.has(song.id)
                  ? "Added"
                  : "Add"}
            </button>
          </li>
        ))}
      </ul>

      {hasMore && !loading && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full rounded-xl border border-neutral-700 py-3 text-sm text-neutral-400 disabled:opacity-40"
        >
          {loadingMore ? "Loading…" : `Load more (${total - songs.length} remaining)`}
        </button>
      )}
    </main>
  );
}
