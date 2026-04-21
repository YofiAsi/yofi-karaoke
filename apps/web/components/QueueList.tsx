import type { QueueItem, SongProgressEvent } from "@karaoke/shared";
import { ProcessingBadge } from "./ProcessingBadge";

interface QueueListProps {
  items: QueueItem[];
  progress: Map<string, SongProgressEvent>;
}

export function QueueList({ items, progress }: QueueListProps) {
  if (items.length === 0) {
    return <p className="text-neutral-500">Nothing queued yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl bg-neutral-900 border border-neutral-800 p-3 flex items-center gap-3"
        >
          <img
            src={item.song.thumbnailUrl}
            alt=""
            className="h-12 w-12 rounded-md object-cover bg-neutral-800"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{item.song.title}</p>
            <p className="text-xs text-neutral-400 truncate">
              {item.song.artist} · {item.requestedByUserName}
            </p>
          </div>
          <ProcessingBadge
            item={item}
            liveProgress={progress.get(item.song.id) ?? null}
          />
        </li>
      ))}
    </ul>
  );
}
