import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsStore } from "./fsStore.js";
import { InvalidStorageKeyError } from "./keys.js";
import type { ObjectStore } from "./types.js";

const KEY = "instrumentals/song-1.mp3";
let root: string;
let store: ObjectStore;

async function put(key: string, body: string): Promise<void> {
  const file = path.join(root, ...key.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

async function read(key: string, range?: { start: number; end: number }): Promise<string | null> {
  const stream = await store.openObjectStream(key, range);
  return stream ? text(stream) : null;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fs-store-"));
  store = createFsStore(root);
  await put(KEY, "0123456789");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("fs store", () => {
  it("stats an object with size, mp3 type and a stable ETag", async () => {
    const info = await store.statObject(KEY);
    expect(info).toMatchObject({ contentLength: 10, contentType: "audio/mpeg" });
    expect(info?.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect((await store.statObject(KEY))?.etag).toBe(info?.etag);
  });

  it("reads the whole object and inclusive byte ranges", async () => {
    expect(await read(KEY)).toBe("0123456789");
    expect(await read(KEY, { start: 0, end: 0 })).toBe("0");
    expect(await read(KEY, { start: 3, end: 6 })).toBe("3456");
    expect(await read(KEY, { start: 7, end: 9 })).toBe("789");
  });

  it("returns null for a missing object", async () => {
    expect(await store.statObject("vocals/none.mp3")).toBeNull();
    expect(await store.openObjectStream("vocals/none.mp3")).toBeNull();
  });

  it("treats a directory as missing", async () => {
    expect(await store.statObject("instrumentals")).toBeNull();
  });

  it("rejects keys that escape the root", async () => {
    await writeFile(path.join(root, "..", "outside.txt"), "x").catch(() => undefined);
    await expect(store.statObject("../outside.txt")).rejects.toThrow(InvalidStorageKeyError);
    await expect(store.openObjectStream("instrumentals/../../outside.txt")).rejects.toThrow(InvalidStorageKeyError);
    await expect(store.deleteObjectKeys(["../outside.txt"])).rejects.toThrow(InvalidStorageKeyError);
  });

  it("lists objects under a prefix with their modification time", async () => {
    await put("instrumentals/song-2.mp3", "x");
    await put("vocals/song-1.mp3", "y");
    const old = new Date("2020-01-01T00:00:00Z");
    await utimes(path.join(root, "instrumentals", "song-2.mp3"), old, old);

    const listed = await store.listObjects("instrumentals/");
    expect(listed.map((o) => o.key).sort()).toEqual([KEY, "instrumentals/song-2.mp3"]);
    expect(listed.find((o) => o.key.endsWith("song-2.mp3"))?.lastModified?.getTime()).toBe(old.getTime());
    expect(await store.listObjects("missing/")).toEqual([]);
  });

  it("deletes objects and ignores ones already gone", async () => {
    expect(await store.deleteObjectKeys([KEY, "vocals/none.mp3"])).toBe(2);
    expect(await store.statObject(KEY)).toBeNull();
  });
});
