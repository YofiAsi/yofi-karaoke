import type { QueueItem, SongProgressEvent } from "@karaoke/shared";

interface ProcessingBadgeProps {
  item: QueueItem;
  liveProgress?: SongProgressEvent | null;
}

export function ProcessingBadge({ item, liveProgress }: ProcessingBadgeProps) {
  if (item.state === "ready") {
    return <span className="text-xs text-emerald-400">ready</span>;
  }
  if (item.state === "failed") {
    return <span className="text-xs font-semibold uppercase tracking-wide text-red-400">failed</span>;
  }
  if (item.state === "processing" || item.state === "queued") {
    const step = liveProgress?.step ?? item.progress?.step ?? "pending";
    const pct = liveProgress?.progressPct ?? item.progress?.progressPct ?? 0;
    return (
      <span className="text-xs text-neutral-400">
        {step} · {pct}%
      </span>
    );
  }
  return <span className="text-xs text-neutral-500">{item.state}</span>;
}
