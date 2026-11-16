"use client";

import { useState } from "react";
import type { MoveDirection, QueueItem, SongProgressEvent, User } from "@karaoke/shared";
import { api } from "@/lib/api";
import { canRemoveItem } from "@/lib/roles";
import { ProcessingBadge } from "./ProcessingBadge";

interface QueueListProps {
  items: QueueItem[];
  progress: Map<string, SongProgressEvent>;
  currentUser: User;
  isHost: boolean;
  onQueueChanged: () => Promise<void>;
}

interface ItemActions {
  busy: boolean;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRetry: () => void;
  onRemove: () => void;
  onMove: (direction: MoveDirection) => void;
}

const SMALL_BUTTON =
  "rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 min-w-8";

function errorMessageOf(item: QueueItem, live: SongProgressEvent | null): string | null {
  if (item.state !== "failed") return null;
  return live?.errorMessage ?? item.progress?.errorMessage ?? null;
}

function QueueItemControls({ item, actions }: { item: QueueItem; actions: ItemActions }) {
  const { busy, canManage, canMoveUp, canMoveDown } = actions;
  return (
    <div className="flex items-center gap-1.5">
      {canMoveUp ? (
        <button
          type="button"
          onClick={() => actions.onMove("up")}
          disabled={busy}
          aria-label={`Move ${item.song.title} up`}
          className={`${SMALL_BUTTON} border-neutral-700 text-neutral-300`}
        >
          ↑
        </button>
      ) : null}
      {canMoveDown ? (
        <button
          type="button"
          onClick={() => actions.onMove("down")}
          disabled={busy}
          aria-label={`Move ${item.song.title} down`}
          className={`${SMALL_BUTTON} border-neutral-700 text-neutral-300`}
        >
          ↓
        </button>
      ) : null}
      {canManage && item.state === "failed" ? (
        <button
          type="button"
          onClick={actions.onRetry}
          disabled={busy}
          className={`${SMALL_BUTTON} border-red-500/60 text-red-300`}
        >
          Retry
        </button>
      ) : null}
      {canManage ? (
        <button
          type="button"
          onClick={actions.onRemove}
          disabled={busy}
          aria-label={`Remove ${item.song.title}`}
          className={`${SMALL_BUTTON} border-neutral-700 text-neutral-400`}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function QueueList({ items, progress, currentUser, isHost, onQueueChanged }: QueueListProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runFor(queueItemId: string, request: () => Promise<unknown>) {
    setBusyId(queueItemId);
    try {
      await request();
      await onQueueChanged();
    } catch (err) {
      console.error(err);
    } finally {
      setBusyId(null);
    }
  }

  function actionsFor(item: QueueItem, index: number): ItemActions {
    const path = `/api/queue/items/${item.id}`;
    return {
      busy: busyId === item.id,
      canManage: canRemoveItem(currentUser, item, isHost),
      canMoveUp: isHost && index > 0,
      canMoveDown: isHost && index < items.length - 1,
      onRetry: () => runFor(item.id, () => api.post(`${path}/retry`)),
      onRemove: () => runFor(item.id, () => api.del(path)),
      onMove: (direction) => runFor(item.id, () => api.post(`${path}/move`, { direction })),
    };
  }

  if (items.length === 0) {
    return <p className="text-neutral-500">Nothing queued yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => {
        const live = progress.get(item.song.id) ?? null;
        const errMsg = errorMessageOf(item, live);
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
              <QueueItemControls item={item} actions={actionsFor(item, index)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
