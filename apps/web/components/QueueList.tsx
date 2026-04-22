"use client";

import { useState } from "react";
import type { QueueItem, SongProgressEvent } from "@karaoke/shared";
import { api } from "@/lib/api";
import { ProcessingBadge } from "./ProcessingBadge";

interface QueueListProps {
  items: QueueItem[];
  progress: Map<string, SongProgressEvent>;
  canRetryAsHost: boolean;
  onQueueChanged: () => Promise<void>;
}

export function QueueList({
  items,
  progress,
  canRetryAsHost,
  onQueueChanged,
}: QueueListProps) {
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function retry(queueItemId: string) {
    setRetryingId(queueItemId);
    try {
      await api.post(`/api/queue/items/${queueItemId}/retry`);
      await onQueueChanged();
    } catch {
      /* ignore */
    } finally {
      setRetryingId(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-neutral-500">Nothing queued yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const live = progress.get(item.song.id) ?? null;
        const errMsg =
          item.state === "failed"
            ? (live?.errorMessage ?? item.progress?.errorMessage ?? null)
            : null;
        return (
          <li
            key={item.id}
            className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-start gap-3"
          >
            <img
              src={item.song.thumbnailUrl}
              alt=""
              className="h-12 w-12 rounded-md object-cover bg-neutral-800 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{item.song.title}</p>
              <p className="text-xs text-neutral-400 truncate">
                {item.song.artist} · {item.requestedByUserName}
              </p>
              {errMsg ? (
                <p className="text-xs text-red-400 mt-1 line-clamp-3">{errMsg}</p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <ProcessingBadge item={item} liveProgress={live} />
              {canRetryAsHost && item.state === "failed" ? (
                <button
                  type="button"
                  onClick={() => retry(item.id)}
                  disabled={retryingId === item.id}
                  className="rounded-full border border-red-500/60 text-red-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  {retryingId === item.id ? "Retrying…" : "Retry"}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
