// Removing and reordering queue items under the playback state row lock.
import { QueueState } from "@prisma/client";
import type { MoveDirection } from "@karaoke/shared";
import { prisma } from "../db.js";
import { lockPlaybackState } from "../playback/transitions.js";
import { httpError } from "./httpError.js";
import { moveDenial, removalDenial, type Actor } from "./permissions.js";
import { VISIBLE_QUEUE_STATES } from "./queueView.js";

export interface PositionedItem {
  id: string;
  position: number;
}

export type SwapPlan =
  | { kind: "missing" }
  | { kind: "edge" }
  | { kind: "swap"; moving: PositionedItem; neighbor: PositionedItem };

export function planSwap(
  upcoming: PositionedItem[],
  queueItemId: string,
  direction: MoveDirection,
): SwapPlan {
  const index = upcoming.findIndex((i) => i.id === queueItemId);
  if (index === -1) return { kind: "missing" };
  const neighbor = upcoming[direction === "up" ? index - 1 : index + 1];
  if (!neighbor) return { kind: "edge" };
  return { kind: "swap", moving: upcoming[index]!, neighbor };
}

export async function removeQueueItem(actor: Actor, queueItemId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const currentId = await lockPlaybackState(tx);
    const item = await tx.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) throw httpError(404, "not_found");
    const denial = removalDenial(actor, item, currentId);
    if (denial) throw denial;
    await tx.queueItem.update({ where: { id: item.id }, data: { state: QueueState.skipped } });
  });
}

export async function moveQueueItem(
  actor: Actor,
  queueItemId: string,
  direction: MoveDirection,
): Promise<boolean> {
  const denial = moveDenial(actor);
  if (denial) throw denial;
  return prisma.$transaction(async (tx) => {
    const currentId = await lockPlaybackState(tx);
    const upcoming = await tx.queueItem.findMany({
      where: { state: { in: VISIBLE_QUEUE_STATES }, ...(currentId ? { id: { not: currentId } } : {}) },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, position: true },
    });
    const plan = planSwap(upcoming, queueItemId, direction);
    if (plan.kind === "missing") throw httpError(409, "not_upcoming");
    if (plan.kind === "edge") return false;
    await tx.queueItem.update({ where: { id: plan.moving.id }, data: { position: plan.neighbor.position } });
    await tx.queueItem.update({ where: { id: plan.neighbor.id }, data: { position: plan.moving.position } });
    return true;
  });
}
