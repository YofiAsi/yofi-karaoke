// Shared pg_notify helpers and the playback state view sent to clients, broadcast in commit order.
import type { PlaybackState, Prisma } from "@prisma/client";
import { PgNotifyChannels, type PlaybackStateView } from "@karaoke/shared";
import { prisma } from "../db.js";

export const PLAYBACK_STATE_ID = 1;

type Db = Pick<Prisma.TransactionClient, "$executeRawUnsafe">;

export async function notify(channel: string, payload: object, db: Db = prisma): Promise<void> {
  await db.$executeRawUnsafe(`SELECT pg_notify($1, $2)`, channel, JSON.stringify(payload));
}

async function lockedPlaybackState(tx: Prisma.TransactionClient): Promise<PlaybackState> {
  await tx.$queryRaw`SELECT id FROM "PlaybackState" WHERE id = ${PLAYBACK_STATE_ID} FOR UPDATE`;
  return tx.playbackState.findUniqueOrThrow({ where: { id: PLAYBACK_STATE_ID } });
}

export function toPlaybackStateView(state: PlaybackState): PlaybackStateView {
  return {
    currentQueueItemId: state.currentQueueItemId ?? null,
    positionSeconds: state.positionSeconds,
    isPlaying: state.isPlaying,
    hostUserId: state.hostUserId ?? null,
    playerUserId: state.playerUserId ?? null,
    vocalsGain: state.vocalsGain,
  };
}

export async function loadPlaybackStateView(): Promise<PlaybackStateView> {
  const state = await prisma.playbackState.findUniqueOrThrow({ where: { id: PLAYBACK_STATE_ID } });
  return toPlaybackStateView(state);
}

export async function notifyPlaybackState(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const view = toPlaybackStateView(await lockedPlaybackState(tx));
    await notify(PgNotifyChannels.playbackState, view, tx);
  });
}

export async function notifyQueueUpdated(reason: string, details: object = {}): Promise<void> {
  await notify(PgNotifyChannels.queueUpdated, { reason, ...details });
}
