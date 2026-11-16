// Adding songs to the queue, reviving failed items, and starting song processing.
import { Prisma, QueueState, type QueueItem, type Song } from "@prisma/client";
import { prisma } from "../db.js";
import { lockPlaybackState } from "../playback/transitions.js";
import { pickTrackMetadata, ytdlpInfo } from "../ytdlp.js";
import { isYtVideoUnavailableMessage } from "../ytdlp/isVideoUnavailable.js";
import { enqueueProcessSong } from "../jobs/enqueueProcessSong.js";
import { asAlreadyQueued, httpError, isUniqueViolation } from "./httpError.js";

type SongReadiness = Pick<Song, "instrumentalObjectKey">;
type Db = Prisma.TransactionClient;

export const ACTIVE_QUEUE_STATES: QueueState[] = [
  QueueState.queued,
  QueueState.processing,
  QueueState.ready,
];

export function isProcessed(song: SongReadiness): boolean {
  return !!song.instrumentalObjectKey;
}

export function newItemState(song: SongReadiness): QueueState {
  return isProcessed(song) ? QueueState.ready : QueueState.processing;
}

export function revivedItemState(song: SongReadiness): QueueState {
  return isProcessed(song) ? QueueState.ready : QueueState.queued;
}

export function needsProcessingJob(song: SongReadiness, hasOpenJob: boolean): boolean {
  return !isProcessed(song) && !hasOpenJob;
}

export async function nextPosition(db: Db = prisma): Promise<number> {
  const agg = await db.queueItem.aggregate({ _max: { position: true } });
  return (agg._max.position ?? 0) + 1;
}

async function withQueueLock<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  return asAlreadyQueued(() =>
    prisma.$transaction(async (tx) => {
      await lockPlaybackState(tx);
      return work(tx);
    }),
  );
}

async function fetchVideoInfo(youtubeVideoId: string) {
  try {
    return await ytdlpInfo(youtubeVideoId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isYtVideoUnavailableMessage(msg)) throw httpError(422, "video_unavailable");
    throw e;
  }
}

async function upsertSong(youtubeVideoId: string): Promise<Song> {
  const info = await fetchVideoInfo(youtubeVideoId);
  const create = {
    youtubeVideoId,
    title: info.title ?? youtubeVideoId,
    artist: info.artist ?? info.uploader ?? info.channel ?? "Unknown",
    channel: info.channel ?? info.uploader ?? "Unknown",
    durationSeconds: Math.round(info.duration ?? 0),
    thumbnailUrl: info.thumbnail ?? info.thumbnails?.[info.thumbnails.length - 1]?.url ?? "",
    ...pickTrackMetadata(info),
  };
  try {
    return await prisma.song.upsert({ where: { youtubeVideoId }, create, update: {} });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.song.findUniqueOrThrow({ where: { youtubeVideoId } });
  }
}

export async function findOrCreateSong(youtubeVideoId: string): Promise<Song> {
  const existing = await prisma.song.findUnique({ where: { youtubeVideoId } });
  return existing ?? upsertSong(youtubeVideoId);
}

async function rejectIfActive(songId: string, exceptId?: string): Promise<void> {
  const active = await prisma.queueItem.findFirst({
    where: { songId, state: { in: ACTIVE_QUEUE_STATES }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (active) throw httpError(409, "already_queued");
}

async function revivalChanges(tx: Db, song: Song, newRequesterId?: string) {
  const state = revivedItemState(song);
  if (!newRequesterId) return { state };
  return { state, requestedByUserId: newRequesterId, position: await nextPosition(tx) };
}

export async function reviveFailedItem(
  item: QueueItem,
  song: Song,
  newRequesterId?: string,
): Promise<QueueItem> {
  await rejectIfActive(song.id, item.id);
  return withQueueLock(async (tx) => {
    const data = await revivalChanges(tx, song, newRequesterId);
    const { count } = await tx.queueItem.updateMany({
      where: { id: item.id, state: QueueState.failed },
      data,
    });
    if (count === 0) throw httpError(409, "already_queued");
    return { ...item, ...data };
  });
}

async function createQueueItem(song: Song, userId: string): Promise<QueueItem> {
  await rejectIfActive(song.id);
  return withQueueLock(async (tx) =>
    tx.queueItem.create({
      data: {
        songId: song.id,
        requestedByUserId: userId,
        position: await nextPosition(tx),
        state: newItemState(song),
      },
    }),
  );
}

async function latestFailedItem(songId: string): Promise<QueueItem | null> {
  return prisma.queueItem.findFirst({
    where: { songId, state: QueueState.failed },
    orderBy: { position: "desc" },
  });
}

async function hasOpenProcessingJob(songId: string): Promise<boolean> {
  const open = await prisma.processingJob.findFirst({
    where: { songId, step: { notIn: ["done", "error"] } },
    select: { id: true },
  });
  return !!open;
}

export async function ensureProcessing(song: Song): Promise<void> {
  if (!needsProcessingJob(song, await hasOpenProcessingJob(song.id))) return;
  await prisma.$transaction([
    prisma.processingJob.deleteMany({ where: { songId: song.id, step: "error" } }),
    prisma.processingJob.create({ data: { songId: song.id, step: "pending", progressPct: 0 } }),
  ]);
  await enqueueProcessSong(song.id);
}

export async function queueSong(song: Song, userId: string): Promise<QueueItem> {
  const failed = await latestFailedItem(song.id);
  const item = failed
    ? await reviveFailedItem(failed, song, userId)
    : await createQueueItem(song, userId);
  await ensureProcessing(song);
  return item;
}
