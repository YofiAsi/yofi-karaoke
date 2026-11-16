import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "./env.js";

const DELETE_BATCH_SIZE = 1000;

export const s3 = new S3Client({
  region: env.MINIO_REGION,
  endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
});

export interface ObjectInfo {
  contentLength: number;
  contentType: string;
  etag: string | null;
}

export function isMissingObjectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

export async function statObject(key: string): Promise<ObjectInfo | null> {
  try {
    const res = await s3.send(
      new HeadObjectCommand({ Bucket: env.MINIO_BUCKET, Key: key }),
    );
    return {
      contentLength: Number(res.ContentLength ?? 0),
      contentType: res.ContentType ?? "audio/mpeg",
      etag: res.ETag ?? null,
    };
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

export async function getObjectStream(
  key: string,
  range?: { start: number; end: number },
): Promise<{
  body: NodeJS.ReadableStream;
  contentLength: number;
  contentType: string;
  acceptRanges: string;
}> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key,
      Range: range ? `bytes=${range.start}-${range.end}` : undefined,
    }),
  );
  return {
    body: res.Body as NodeJS.ReadableStream,
    contentLength: Number(res.ContentLength ?? 0),
    contentType: res.ContentType ?? "audio/mpeg",
    acceptRanges: res.AcceptRanges ?? "bytes",
  };
}

export async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: env.MINIO_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function deleteObjectKeys(keys: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.MINIO_BUCKET,
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
