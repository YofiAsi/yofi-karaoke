// Builds the queue view: current comes from PlaybackState, upcoming from position order.
import { QueueState, type ProcessingJob, type QueueItem, type Song, type User } from "@prisma/client";
import type { ProcessingStep, QueueItem as QueueItemView, QueueView } from "@karaoke/shared";
import { prisma } from "../db.js";
import { PLAYBACK_STATE_ID } from "../playback/notify.js";

export const VISIBLE_QUEUE_STATES: QueueState[] = [
  QueueState.queued,
  QueueState.processing,
  QueueState.ready,
  QueueState.failed,
];

export type QueueItemWithRelations = QueueItem & { song: Song; requestedByUser: User };
type JobSummary = Pick<ProcessingJob, "songId" | "step" | "progressPct" | "errorMessage">;

function toSongView(song: Song): QueueItemView["song"] {
  return {
    id: song.id,
    youtubeVideoId: song.youtubeVideoId,
    title: song.title,
    artist: song.artist,
    channel: song.channel,
    durationSeconds: song.durationSeconds,
    thumbnailUrl: song.thumbnailUrl,
    hasInstrumental: !!song.instrumentalObjectKey,
    hasLyrics: !!(song.lyricsLrc || song.lyricsPlain),
  };
}

function toProgressView(job: JobSummary | undefined): QueueItemView["progress"] {
  if (!job) return null;
  return {
    step: job.step as ProcessingStep,
    progressPct: job.progressPct,
    errorMessage: job.errorMessage ?? null,
  };
}

function toItemView(item: QueueItemWithRelations, job: JobSummary | undefined): QueueItemView {
  return {
    id: item.id,
    song: toSongView(item.song),
    requestedByUserId: item.requestedByUserId,
    requestedByUserName: item.requestedByUser.name,
    position: item.position,
    state: item.state as QueueItemView["state"],
    progress: toProgressView(job),
  };
}

function latestJobBySong(jobs: JobSummary[]): Map<string, JobSummary> {
  const bySong = new Map<string, JobSummary>();
  for (const job of jobs) {
    if (!bySong.has(job.songId)) bySong.set(job.songId, job);
  }
  return bySong;
}

export function buildQueueView(
  items: QueueItemWithRelations[],
  currentQueueItemId: string | null,
  jobsNewestFirst: JobSummary[],
): QueueView {
  const jobs = latestJobBySong(jobsNewestFirst);
  const view = (item: QueueItemWithRelations) => toItemView(item, jobs.get(item.songId));
  const current = items.find((i) => i.id === currentQueueItemId && i.state === QueueState.ready);
  return {
    current: current ? view(current) : null,
    upcoming: items
      .filter((i) => i.id !== current?.id)
      .sort((a, b) => a.position - b.position)
      .map(view),
  };
}

export async function loadQueueView(): Promise<QueueView> {
  const playback = await prisma.playbackState.findUnique({ where: { id: PLAYBACK_STATE_ID } });
  const items = await prisma.queueItem.findMany({
    where: { state: { in: VISIBLE_QUEUE_STATES } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { song: true, requestedByUser: true },
  });
  const songIds = items.map((i) => i.songId);
  const jobs = songIds.length
    ? await prisma.processingJob.findMany({
        where: { songId: { in: songIds } },
        orderBy: { startedAt: "desc" },
      })
    : [];
  return buildQueueView(items, playback?.currentQueueItemId ?? null, jobs);
}
