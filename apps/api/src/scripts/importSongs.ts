/* Adds YouTube videos to the library and starts their processing without putting them in the play queue. Argument: a text file with one YouTube link or video id per line. */
import { readFile } from "node:fs/promises";
import { prisma } from "../db.js";
import { ensureProcessing, findOrCreateSong, isProcessed } from "../queue/addition.js";
import { parseVideoIds } from "./videoIds.js";

async function importSong(youtubeVideoId: string): Promise<string> {
  const song = await findOrCreateSong(youtubeVideoId);
  if (isProcessed(song)) return `already in the library: ${song.title}`;
  await ensureProcessing(song);
  return `processing started: ${song.title}`;
}

async function describeImport(youtubeVideoId: string): Promise<string> {
  try {
    return await importSong(youtubeVideoId);
  } catch (err) {
    return `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function main(): Promise<void> {
  const listFile = process.argv[2];
  if (!listFile) throw new Error("pass a text file with one YouTube link or video id per line");
  const ids = parseVideoIds(await readFile(listFile, "utf8"));
  console.log(`found ${ids.length} video ids in ${listFile}`);
  let failed = 0;
  for (const [index, id] of ids.entries()) {
    const outcome = await describeImport(id);
    if (outcome.startsWith("FAILED")) failed += 1;
    console.log(`${index + 1}/${ids.length} ${id} ${outcome}`);
  }
  console.log(`done: ${ids.length - failed} accepted, ${failed} failed; songs appear in the library as the worker finishes them`);
}

main()
  .catch((err) => {
    console.error("import failed", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
