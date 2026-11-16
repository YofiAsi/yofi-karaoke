/* Picks the object store driver from STORAGE_DRIVER and exposes it to routes and scripts. */
import { parseStorageConfig } from "./config.js";
import { createFsStore } from "./fsStore.js";
import type { ObjectStore } from "./types.js";

export type { ByteRange, ObjectInfo, StoredObject } from "./types.js";

async function createStore(): Promise<ObjectStore> {
  const config = parseStorageConfig(process.env);
  if (config.STORAGE_DRIVER === "fs") return createFsStore(config.STORAGE_DIR as string);
  const { createS3Store } = await import("./s3Store.js");
  return createS3Store();
}

let storePromise: Promise<ObjectStore> | null = null;

function store(): Promise<ObjectStore> {
  storePromise ??= createStore();
  return storePromise;
}

export const storage: ObjectStore = {
  statObject: async (key) => (await store()).statObject(key),
  openObjectStream: async (key, range) => (await store()).openObjectStream(key, range),
  listObjects: async (prefix) => (await store()).listObjects(prefix),
  deleteObjectKeys: async (keys) => (await store()).deleteObjectKeys(keys),
};
