/* Manual one off cleanup: deletes every stored stem object. Run with `corepack pnpm --filter api purge:objects --yes`. */
import { deleteObjectKeys, listObjectKeys } from "../minio.js";

const STEM_PREFIXES = ["instrumentals/", "vocals/"];
const CONFIRM_FLAG = "--yes";

async function collectStemKeys(): Promise<string[]> {
  const keys: string[] = [];
  for (const prefix of STEM_PREFIXES) {
    keys.push(...(await listObjectKeys(prefix)));
  }
  return keys;
}

async function main(): Promise<void> {
  const keys = await collectStemKeys();
  if (!process.argv.includes(CONFIRM_FLAG)) {
    console.log(`found ${keys.length} objects under ${STEM_PREFIXES.join(", ")}; rerun with ${CONFIRM_FLAG} to delete them`);
    return;
  }
  const deleted = await deleteObjectKeys(keys);
  console.log(`deleted ${deleted} objects under ${STEM_PREFIXES.join(", ")}`);
}

main().catch((err) => {
  console.error("purge failed", err);
  process.exit(1);
});
