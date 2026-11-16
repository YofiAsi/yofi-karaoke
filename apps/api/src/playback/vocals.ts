// Vocals gain for the current song: who may change it and the guarded write.
import { QueueState } from "@prisma/client";
import { prisma } from "../db.js";
import { httpError, type HttpError } from "../queue/httpError.js";
import type { Actor } from "../queue/permissions.js";
import { PLAYBACK_STATE_ID } from "./notify.js";

export interface CurrentForVocals {
  id: string;
  requestedByUserId: string;
  hasVocals: boolean;
}

export function vocalsGainDenial(
  actor: Actor,
  current: CurrentForVocals | null,
  queueItemId: string,
): HttpError | null {
  if (!current || current.id !== queueItemId) return httpError(409, "not_current");
  if (!actor.isHost && actor.userId !== current.requestedByUserId) return httpError(403, "forbidden");
  if (!current.hasVocals) return httpError(409, "no_vocals");
  return null;
}

export async function loadCurrentForVocals(): Promise<CurrentForVocals | null> {
  const playback = await prisma.playbackState.findUnique({ where: { id: PLAYBACK_STATE_ID } });
  if (!playback?.currentQueueItemId) return null;
  const item = await prisma.queueItem.findUnique({
    where: { id: playback.currentQueueItemId },
    select: { id: true, state: true, requestedByUserId: true, song: { select: { vocalsObjectKey: true } } },
  });
  if (!item || item.state !== QueueState.ready) return null;
  return { id: item.id, requestedByUserId: item.requestedByUserId, hasVocals: !!item.song.vocalsObjectKey };
}

export async function storeVocalsGain(queueItemId: string, vocalsGain: number): Promise<boolean> {
  const { count } = await prisma.playbackState.updateMany({
    where: { id: PLAYBACK_STATE_ID, currentQueueItemId: queueItemId },
    data: { vocalsGain },
  });
  return count === 1;
}
