import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";

export const s3 = new S3Client({
  region: env.MINIO_REGION,
  endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
});

export async function statObject(key: string): Promise<{
  contentLength: number;
  contentType: string;
}> {
  const res = await s3.send(
    new HeadObjectCommand({ Bucket: env.MINIO_BUCKET, Key: key }),
  );
  return {
    contentLength: Number(res.ContentLength ?? 0),
    contentType: res.ContentType ?? "audio/mpeg",
  };
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
