/* Stores stems with the driver chosen by STORAGE_DRIVER and returns their object keys. */
import { env } from "../env.js";
import { putFsObject } from "./fsUpload.js";
import { stemObjectKey, type StemKind } from "./keys.js";
import { putS3Object } from "./s3Upload.js";

export { stemObjectKey, type StemKind } from "./keys.js";

export async function uploadStem(kind: StemKind, songId: string, filePath: string): Promise<string> {
  const key = stemObjectKey(kind, songId);
  if (env.STORAGE_DRIVER === "fs") await putFsObject(env.STORAGE_DIR as string, key, filePath);
  else await putS3Object(key, filePath);
  return key;
}
