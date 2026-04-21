import type { QueueItem, PlaybackStateView } from "@karaoke/shared";

interface NowPlayingProps {
  current: QueueItem | null;
  playbackState: PlaybackStateView | null;
}

export function NowPlaying({ current, playbackState }: NowPlayingProps) {
  if (!current) {
    return (
      <p className="text-neutral-500 mt-3">Queue is empty. Add a song to start.</p>
    );
  }

  const duration = current.song.durationSeconds;
  const position = playbackState?.positionSeconds ?? 0;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <>
      <h2 className="text-2xl font-semibold leading-tight mt-1">
        {current.song.title}
      </h2>
      <p className="text-neutral-400 text-sm mt-1">
        {current.song.artist} · requested by {current.requestedByUserName}
      </p>
      {duration > 0 && (
        <div className="mt-4 h-1 rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </>
  );
}
