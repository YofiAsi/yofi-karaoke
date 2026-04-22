"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SearchResultItem } from "@karaoke/shared";
import { api } from "@/lib/api";
import { useAppShell } from "../AppShellContext";
import { useRouter } from "next/navigation";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SearchPage() {
  const router = useRouter();
  const { user } = useAppShell();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get<SearchResultItem[]>(
          `/api/search?q=${encodeURIComponent(q)}`,
        );
        setResults(data);
        setError(null);
      } catch {
        setError("Search failed. Try again.");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function addToQueue(item: SearchResultItem) {
    setSubmitting(item.youtubeVideoId);
    try {
      await api.post("/api/queue", { youtubeVideoId: item.youtubeVideoId });
      router.push("/");
    } catch {
      setError("Could not add to queue.");
    } finally {
      setSubmitting(null);
    }
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-5 flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-neutral-400 text-sm">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Add a song</h1>
      </header>

      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search YouTube…"
        className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Searching…</p>}

      <ul className="flex flex-col gap-2">
        {results.map((r) => (
          <li
            key={r.youtubeVideoId}
            className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-center gap-3"
          >
            <img
              src={r.thumbnailUrl}
              alt=""
              className="h-16 w-16 rounded-md object-cover bg-neutral-800"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium line-clamp-2">{r.title}</p>
              <p className="text-xs text-neutral-400 truncate">
                {r.channel} · {formatDuration(r.durationSeconds)}
              </p>
            </div>
            <button
              onClick={() => addToQueue(r)}
              disabled={submitting === r.youtubeVideoId}
              className="rounded-full bg-white text-black px-3 py-2 text-xs font-semibold disabled:opacity-40"
            >
              {submitting === r.youtubeVideoId ? "Adding…" : "Add"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
