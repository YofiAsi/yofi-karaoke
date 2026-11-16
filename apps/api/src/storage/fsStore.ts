/* Object store backed by a local folder; keys map to files below the root. */
import { open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveKeyPath, splitPrefix } from "./keys.js";
import type { ByteRange, ObjectInfo, ObjectStore, StoredObject } from "./types.js";

const CONTENT_TYPES: Record<string, string> = { ".mp3": "audio/mpeg" };

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function etagFor(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
}

function isMissingFileError(err: unknown): boolean {
  const code = errorCode(err);
  return code === "ENOENT" || code === "ENOTDIR";
}

async function statFile(file: string) {
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch (err) {
    if (isMissingFileError(err)) return null;
    throw err;
  }
}

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }
}

async function removeFile(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (err) {
    if (!isMissingFileError(err)) throw err;
  }
}

export function createFsStore(root: string): ObjectStore {
  const toPath = (key: string) => resolveKeyPath(root, key);

  async function statObject(key: string): Promise<ObjectInfo | null> {
    const file = toPath(key);
    const info = await statFile(file);
    if (!info) return null;
    return { contentLength: info.size, contentType: contentTypeFor(file), etag: etagFor(info.size, info.mtimeMs) };
  }

  async function openObjectStream(key: string, range?: ByteRange) {
    try {
      const handle = await open(toPath(key), "r");
      return handle.createReadStream(range ? { start: range.start, end: range.end } : {});
    } catch (err) {
      if (isMissingFileError(err)) return null;
      throw err;
    }
  }

  async function listObjects(prefix: string): Promise<StoredObject[]> {
    const { dir, namePrefix } = splitPrefix(prefix);
    const dirPath = dir ? toPath(dir.slice(0, -1)) : path.resolve(root);
    const entries = await listDir(dirPath);
    const files = entries.filter((e) => e.isFile() && e.name.startsWith(namePrefix));
    return Promise.all(
      files.map(async (e) => ({
        key: `${dir}${e.name}`,
        lastModified: (await stat(path.join(dirPath, e.name))).mtime,
      })),
    );
  }

  async function deleteObjectKeys(keys: string[]): Promise<number> {
    for (const key of keys) await removeFile(toPath(key));
    return keys.length;
  }

  return { statObject, openObjectStream, listObjects, deleteObjectKeys };
}
