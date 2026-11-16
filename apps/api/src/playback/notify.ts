// Shared pg_notify helpers and the playback state view sent to clients.
import type { PlaybackState } from "@prisma/client";
import { PgNotifyChannels, type PlaybackStateView } from "@karaoke/shared";
import { prisma } from "../db.js";

export const PLAYBACK_STATE_ID = 1;

export async function notify(channel: string, payload: object): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT pg_notify($1, $2)`, channel, JSON.stringify(payload));
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
  await notify(PgNotifyChannels.playbackState, await loadPlaybackStateView());
}

export async function notifyQueueUpdated(reason: string, details: object = {}): Promise<void> {
  await notify(PgNotifyChannels.queueUpdated, { reason, ...details });
}
