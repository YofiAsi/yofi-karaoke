/* Gives a local file path for a stored stem: the stored file itself with the folder driver, a temporary download otherwise. */
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { env } from "../env.js";
import { resolveKeyPath } from "./keys.js";
import { getS3ObjectStream } from "./s3Upload.js";

async function downloadToTemp(key: string): Promise<{ file: string; dir: string }> {
  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(env.WORKER_TMP_DIR, "stem-"));
  const file = path.join(dir, path.basename(key));
  await pipeline((await getS3ObjectStream(key)) as Readable, createWriteStream(file));
  return { file, dir };
}

export async function withStemFile<T>(key: string, use: (file: string) => Promise<T>): Promise<T> {
  if (env.STORAGE_DRIVER === "fs") return use(resolveKeyPath(env.STORAGE_DIR as string, key));
  const { file, dir } = await downloadToTemp(key);
  try {
    return await use(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
