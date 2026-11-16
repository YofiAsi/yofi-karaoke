// Who may change a queue item, expressed as pure checks over the acting user.
import { QueueState } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { PLAYBACK_STATE_ID } from "../playback/notify.js";
import { httpError, type HttpError } from "./httpError.js";

export interface Actor {
  userId: string;
  isHost: boolean;
}

export interface ItemOwnership {
  id: string;
  requestedByUserId: string;
  state: QueueState;
}

const REMOVABLE_STATES: QueueState[] = [
  QueueState.queued,
  QueueState.processing,
  QueueState.ready,
  QueueState.failed,
];

export async function loadActor(req: FastifyRequest): Promise<Actor> {
  const user = await requireUser(req);
  const playback = await prisma.playbackState.findUnique({ where: { id: PLAYBACK_STATE_ID } });
  return { userId: user.id, isHost: user.isHost && playback?.hostUserId === user.id };
}

function ownsOrHosts(actor: Actor, item: ItemOwnership): boolean {
  return actor.isHost || actor.userId === item.requestedByUserId;
}

export function removalDenial(
  actor: Actor,
  item: ItemOwnership,
  currentQueueItemId: string | null,
): HttpError | null {
  if (!ownsOrHosts(actor, item)) return httpError(403, "forbidden");
  if (item.id === currentQueueItemId) return httpError(409, "is_current");
  if (!REMOVABLE_STATES.includes(item.state)) return httpError(409, "not_removable");
  return null;
}

export function retryDenial(actor: Actor, item: ItemOwnership): HttpError | null {
  if (!ownsOrHosts(actor, item)) return httpError(403, "forbidden");
  if (item.state !== QueueState.failed) return httpError(400, "not_failed");
  return null;
}

export function moveDenial(actor: Actor): HttpError | null {
  return actor.isHost ? null : httpError(403, "forbidden");
}
