/* Manual cleanup of stem objects no Song references. Dry run by default; `corepack pnpm --filter api purge:objects --yes` deletes. */
import { prisma } from "../db.js";
import { storage, type StoredObject } from "../storage/index.js";
import { planPurge, PURGE_MIN_AGE_MS } from "./purgePlan.js";

const STEM_PREFIXES = ["instrumentals/", "vocals/"];
const CONFIRM_FLAG = "--yes";

async function listStemObjects(): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  for (const prefix of STEM_PREFIXES) {
    objects.push(...(await storage.listObjects(prefix)));
  }
  return objects;
}

async function loadReferencedKeys(): Promise<Set<string>> {
  const songs = await prisma.song.findMany({
    select: { instrumentalObjectKey: true, vocalsObjectKey: true },
  });
  const keys = songs.flatMap((s) => [s.instrumentalObjectKey, s.vocalsObjectKey]);
  return new Set(keys.filter((k): k is string => !!k));
}

async function main(): Promise<void> {
  const objects = await listStemObjects();
  const plan = planPurge(objects, await loadReferencedKeys(), new Date());
  const minutes = PURGE_MIN_AGE_MS / 60_000;
  console.log(
    `found ${objects.length} objects under ${STEM_PREFIXES.join(", ")}: ` +
      `kept ${plan.keptReferenced} referenced by a song, kept ${plan.keptRecent} newer than ${minutes} minutes, ` +
      `${plan.deleteKeys.length} unreferenced`,
  );
  if (!process.argv.includes(CONFIRM_FLAG)) {
    console.log(`dry run; rerun with ${CONFIRM_FLAG} to delete the ${plan.deleteKeys.length} unreferenced objects`);
    return;
  }
  const deleted = await storage.deleteObjectKeys(plan.deleteKeys);
  console.log(`deleted ${deleted} objects, kept ${plan.keptReferenced + plan.keptRecent}`);
}

main()
  .catch((err) => {
    console.error("purge failed", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
