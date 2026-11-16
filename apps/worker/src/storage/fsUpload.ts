/* Copies stem files into the storage folder, replacing any previous file atomically. */
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { resolveKeyPath } from "./keys.js";

export async function putFsObject(root: string, key: string, filePath: string): Promise<string> {
  const target = resolveKeyPath(root, key);
  const partial = `${target}.${process.pid}.partial`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await copyFile(filePath, partial);
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
  return target;
}
