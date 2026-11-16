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

export type MovePlan =
  | { kind: "missing" }
  | { kind: "edge" }
  | { kind: "reorder"; updates: PositionedItem[] };

function swapAt<T>(list: T[], a: number, b: number): T[] {
  const copy = [...list];
  [copy[a], copy[b]] = [copy[b]!, copy[a]!];
  return copy;
}

function strictlyAscending(positions: number[]): number[] {
  const slots: number[] = [];
  for (const position of positions) {
    const previous = slots[slots.length - 1];
    slots.push(previous !== undefined && position <= previous ? previous + 1 : position);
  }
  return slots;
}

export function planMove(
  upcoming: PositionedItem[],
  queueItemId: string,
  direction: MoveDirection,
): MovePlan {
  const index = upcoming.findIndex((i) => i.id === queueItemId);
  if (index === -1) return { kind: "missing" };
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= upcoming.length) return { kind: "edge" };
  const reordered = swapAt(upcoming, index, target);
  const slots = strictlyAscending(upcoming.map((i) => i.position));
  const updates = reordered
    .map((item, i) => ({ id: item.id, position: slots[i]! }))
    .filter((update, i) => update.position !== reordered[i]!.position);
  return { kind: "reorder", updates };
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
    const plan = planMove(upcoming, queueItemId, direction);
    if (plan.kind === "missing") throw httpError(409, "not_upcoming");
    if (plan.kind === "edge") return false;
    for (const update of plan.updates) {
      await tx.queueItem.update({ where: { id: update.id }, data: { position: update.position } });
    }
    return true;
  });
}
