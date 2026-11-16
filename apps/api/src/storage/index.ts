/* Picks the object store driver from STORAGE_DRIVER and exposes it to routes and scripts. */
import { env } from "../env.js";
import { createFsStore } from "./fsStore.js";
import { createS3Store } from "./s3Store.js";
import type { ObjectStore } from "./types.js";

export type { ByteRange, ObjectInfo, StoredObject } from "./types.js";

function createStore(): ObjectStore {
  if (env.STORAGE_DRIVER === "fs") return createFsStore(env.STORAGE_DIR as string);
  return createS3Store();
}

export const storage: ObjectStore = createStore();
