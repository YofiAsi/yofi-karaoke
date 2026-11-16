/* Object store backed by MinIO or any S3 compatible service. */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../env.js";
import type { ByteRange, ObjectInfo, ObjectStore, StoredObject } from "./types.js";

const DELETE_BATCH_SIZE = 1000;

function createClient(): S3Client {
  return new S3Client({
    region: env.MINIO_REGION,
    endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY,
      secretAccessKey: env.MINIO_SECRET_KEY,
    },
  });
}

function isMissingS3ObjectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

export function createS3Store(): ObjectStore {
  const s3 = createClient();
  const bucket = env.MINIO_BUCKET;

  async function statObject(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        contentLength: Number(res.ContentLength ?? 0),
        contentType: res.ContentType ?? "audio/mpeg",
        etag: res.ETag ?? null,
      };
    } catch (err) {
      if (isMissingS3ObjectError(err)) return null;
      throw err;
    }
  }

  async function openObjectStream(key: string, range?: ByteRange) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      return res.Body as NodeJS.ReadableStream;
    } catch (err) {
      if (isMissingS3ObjectError(err)) return null;
      throw err;
    }
  }

  async function listObjects(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const item of res.Contents ?? []) {
        if (item.Key) objects.push({ key: item.Key, lastModified: item.LastModified ?? null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return objects;
  }

  async function deleteObjectKeys(keys: string[]): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      const res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (res.Errors?.length) {
        throw new Error(`failed to delete ${res.Errors.length} objects, first: ${res.Errors[0].Key} ${res.Errors[0].Message}`);
      }
      deleted += batch.length;
    }
    return deleted;
  }

  return { statObject, openObjectStream, listObjects, deleteObjectKeys };
}
