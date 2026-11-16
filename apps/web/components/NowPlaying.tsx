import type { QueueItem, PlaybackStateView } from "@karaoke/shared";
import { formatDuration } from "@/lib/formatDuration";

interface NowPlayingProps {
  current: QueueItem | null;
  playbackState: PlaybackStateView | null;
  hasReadyUpcoming?: boolean;
}

export function NowPlaying({ current, playbackState, hasReadyUpcoming = false }: NowPlayingProps) {
  if (!current) {
    return (
      <p className="text-neutral-500 mt-3">
        {hasReadyUpcoming ? "Songs are ready. The host can press play to start." : "Queue is empty. Add a song to start."}
      </p>
    );
  }

  const duration = current.song.durationSeconds;
  const position = playbackState?.positionSeconds ?? 0;
  const displayPosition = duration > 0 ? Math.min(position, duration) : position;
  const pct = duration > 0 ? Math.min(100, (displayPosition / duration) * 100) : 0;

  return (
    <>
      <h2 dir="auto" className="text-2xl font-semibold leading-tight mt-1 text-start">
        {current.song.title}
      </h2>
      <p className="text-neutral-400 text-sm mt-1">
        <bdi>{current.song.artist}</bdi> · requested by <bdi>{current.requestedByUserName}</bdi>
      </p>
      {duration > 0 && (
        <div className="mt-4 flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-xs text-neutral-500 tabular-nums text-right">
            {formatDuration(displayPosition)}
          </span>
          <div className="flex-1 min-w-0 h-1 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-1000"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
            {formatDuration(duration)}
          </span>
        </div>
      )}
    </>
  );
}
