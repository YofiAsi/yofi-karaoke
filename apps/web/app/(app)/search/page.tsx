"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResultItem } from "@karaoke/shared";
import { api } from "@/lib/api";
import { addSongErrorMessage } from "@/lib/addSongError";
import { formatDuration } from "@/lib/formatDuration";
import { searchYoutube, type SearchOutcome } from "@/lib/searchRequest";
import { useAppShell } from "../AppShellContext";

const DEBOUNCE_MS = 350;

type SearchStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; query: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "error"; message: string };

function statusOf(outcome: SearchOutcome, query: string): SearchStatus {
  if (outcome.kind === "ok") return { kind: "done", query };
  if (outcome.kind === "rate_limited") return { kind: "rate_limited", retryAfterSeconds: outcome.retryAfterSeconds };
  if (outcome.kind === "unavailable") return { kind: "error", message: "That video is unavailable or private." };
  return { kind: "error", message: "Search failed. Try again." };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function useYoutubeSearch(query: string) {
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });
  const latestQuery = useRef("");

  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (!q) {
      setResults([]);
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "loading" });
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && latestQuery.current === q;

    const timer = setTimeout(async () => {
      try {
        const outcome = await searchYoutube(q, controller.signal);
        if (!isCurrent()) return;
        setResults(outcome.kind === "ok" ? outcome.results : []);
        setStatus(statusOf(outcome, q));
      } catch (err) {
        if (isAbort(err) || !isCurrent()) return;
        setResults([]);
        setStatus({ kind: "error", message: "Search failed. Check your connection." });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { results, status };
}

function StatusMessage({ status, resultCount }: { status: SearchStatus; resultCount: number }) {
  switch (status.kind) {
    case "idle":
      return <p className="text-sm text-neutral-500">Type a song or artist name, in any language.</p>;
    case "loading":
      return <p className="text-sm text-neutral-500">Searching…</p>;
    case "rate_limited":
      return (
        <p className="text-sm text-amber-400">
          Too many searches. Try again in about {status.retryAfterSeconds} seconds.
        </p>
      );
    case "error":
      return <p className="text-sm text-red-400">{status.message}</p>;
    case "done":
      return resultCount === 0 ? (
        <p className="text-neutral-500 text-center py-10">
          No singable results for “<bdi>{status.query}</bdi>”. Try another spelling or add the artist.
        </p>
      ) : null;
  }
}

interface ResultRowProps {
  result: SearchResultItem;
  submitting: boolean;
  onAdd: () => void;
}

function ResultRow({ result, submitting, onAdd }: ResultRowProps) {
  return (
    <li className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-center gap-3">
      <img src={result.thumbnailUrl} alt="" className="h-16 w-16 rounded-md object-cover bg-neutral-800" />
      <div className="flex-1 min-w-0">
        <p dir="auto" className="font-medium line-clamp-2 text-start">
          {result.title}
        </p>
        <p className="text-xs text-neutral-400 truncate">
          <bdi>{result.channel}</bdi> · {formatDuration(result.durationSeconds)}
        </p>
      </div>
      <button
        onClick={onAdd}
        disabled={submitting}
        className="rounded-full bg-white text-black px-3 py-2 text-xs font-semibold disabled:opacity-40"
      >
        {submitting ? "Adding…" : "Add"}
      </button>
    </li>
  );
}

export default function SearchPage() {
  const router = useRouter();
  const { user } = useAppShell();
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const { results, status } = useYoutubeSearch(query);

  async function addToQueue(item: SearchResultItem) {
    setSubmitting(item.youtubeVideoId);
    setAddError(null);
    try {
      await api.post("/api/queue", { youtubeVideoId: item.youtubeVideoId });
      router.push("/");
    } catch (e) {
      setAddError(addSongErrorMessage(e));
    } finally {
      setSubmitting(null);
    }
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-5 flex flex-col gap-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-neutral-400 text-sm">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Add a song</h1>
        <Link href="/library" className="ms-auto text-sm text-neutral-300 underline underline-offset-4">
          Ready songs
        </Link>
      </header>

      <input
        autoFocus
        dir="auto"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search YouTube…"
        className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500 text-start"
      />

      {addError && (
        <p role="alert" className="text-sm text-red-400">
          {addError}
        </p>
      )}
      <StatusMessage status={status} resultCount={results.length} />

      <ul className="flex flex-col gap-2">
        {results.map((r) => (
          <ResultRow
            key={r.youtubeVideoId}
            result={r}
            submitting={submitting === r.youtubeVideoId}
            onAdd={() => addToQueue(r)}
          />
        ))}
      </ul>
    </main>
  );
}
