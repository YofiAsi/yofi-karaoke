/* Chooses which stored stems the purge script may delete: unreferenced by any Song and older than a grace period. */
import type { StoredObject } from "../minio.js";

export const PURGE_MIN_AGE_MS = 60 * 60_000;

export interface PurgePlan {
  deleteKeys: string[];
  keptReferenced: number;
  keptRecent: number;
}

function isRecent(object: StoredObject, now: Date, minAgeMs: number): boolean {
  if (!object.lastModified) return false;
  return now.getTime() - object.lastModified.getTime() < minAgeMs;
}

export function planPurge(
  objects: StoredObject[],
  referencedKeys: Set<string>,
  now: Date,
  minAgeMs: number = PURGE_MIN_AGE_MS,
): PurgePlan {
  const plan: PurgePlan = { deleteKeys: [], keptReferenced: 0, keptRecent: 0 };
  for (const object of objects) {
    if (referencedKeys.has(object.key)) plan.keptReferenced += 1;
    else if (isRecent(object, now, minAgeMs)) plan.keptRecent += 1;
    else plan.deleteKeys.push(object.key);
  }
  return plan;
}
