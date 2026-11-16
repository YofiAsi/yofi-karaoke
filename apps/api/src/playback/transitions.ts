// Playback transitions guarded by a conditional update on the current queue item.
import { Prisma, QueueState } from "@prisma/client";
import type { PlaybackTransitionResult } from "@karaoke/shared";
import { prisma } from "../db.js";
import { PLAYBACK_STATE_ID } from "./notify.js";

type Db = Prisma.TransactionClient;

async function claimCurrent(tx: Db, expectedQueueItemId: string | null): Promise<boolean> {
  const { count } = await tx.playbackState.updateMany({
    where: { id: PLAYBACK_STATE_ID, currentQueueItemId: expectedQueueItemId },
    data: { positionSeconds: 0 },
  });
  return count === 1;
}

async function readCurrentId(db: Db): Promise<string | null> {
  const state = await db.playbackState.findUniqueOrThrow({ where: { id: PLAYBACK_STATE_ID } });
  return state.currentQueueItemId ?? null;
}

async function unchanged(tx: Db): Promise<PlaybackTransitionResult> {
  return { changed: false, currentQueueItemId: await readCurrentId(tx) };
}

async function setCurrent(tx: Db, queueItemId: string | null): Promise<void> {
  await tx.playbackState.update({
    where: { id: PLAYBACK_STATE_ID },
    data: { currentQueueItemId: queueItemId, positionSeconds: 0, isPlaying: queueItemId !== null },
  });
}

async function markPlayed(tx: Db, queueItemId: string): Promise<void> {
  await tx.queueItem.updateMany({
    where: { id: queueItemId, state: QueueState.ready },
    data: { state: QueueState.played, playedAt: new Date() },
  });
}

async function firstReadyItemId(tx: Db, excludeId: string | null): Promise<string | null> {
  const next = await tx.queueItem.findFirst({
    where: { state: QueueState.ready, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return next?.id ?? null;
}

async function lastPlayedItemId(tx: Db): Promise<string | null> {
  const last = await tx.queueItem.findFirst({
    where: { state: QueueState.played },
    orderBy: { playedAt: "desc" },
    select: { id: true },
  });
  return last?.id ?? null;
}

async function isReady(db: Db, queueItemId: string): Promise<boolean> {
  const item = await db.queueItem.findUnique({ where: { id: queueItemId }, select: { state: true } });
  return item?.state === QueueState.ready;
}

export async function advance(expectedQueueItemId: string | null): Promise<PlaybackTransitionResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await claimCurrent(tx, expectedQueueItemId))) return unchanged(tx);
    if (expectedQueueItemId) await markPlayed(tx, expectedQueueItemId);
    const nextId = await firstReadyItemId(tx, expectedQueueItemId);
    await setCurrent(tx, nextId);
    return { changed: expectedQueueItemId !== null || nextId !== null, currentQueueItemId: nextId };
  });
}

export async function rewind(expectedQueueItemId: string | null): Promise<PlaybackTransitionResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await claimCurrent(tx, expectedQueueItemId))) return unchanged(tx);
    const previousId = await lastPlayedItemId(tx);
    if (!previousId) return { changed: expectedQueueItemId !== null, currentQueueItemId: expectedQueueItemId };
    await tx.queueItem.update({
      where: { id: previousId },
      data: { state: QueueState.ready, playedAt: null },
    });
    await setCurrent(tx, previousId);
    return { changed: true, currentQueueItemId: previousId };
  });
}

async function resume(currentId: string): Promise<PlaybackTransitionResult> {
  const { count } = await prisma.playbackState.updateMany({
    where: { id: PLAYBACK_STATE_ID, currentQueueItemId: currentId },
    data: { isPlaying: true },
  });
  return { changed: count === 1, currentQueueItemId: currentId };
}

export async function play(): Promise<PlaybackTransitionResult> {
  const currentId = await readCurrentId(prisma);
  if (currentId && (await isReady(prisma, currentId))) return resume(currentId);
  return advance(currentId);
}

export async function lockPlaybackState(tx: Db): Promise<string | null> {
  const rows = await tx.$queryRaw<{ currentQueueItemId: string | null }[]>`
    SELECT "currentQueueItemId" FROM "PlaybackState" WHERE id = ${PLAYBACK_STATE_ID} FOR UPDATE`;
  return rows[0]?.currentQueueItemId ?? null;
}
