/* Uploads stem files to MinIO or any S3 compatible service and streams them back. */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../env.js";

let client: S3Client | null = null;
let bucketEnsured = false;

function s3(): S3Client {
  client ??= new S3Client({
    region: env.MINIO_REGION,
    endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY ?? "",
      secretAccessKey: env.MINIO_SECRET_KEY ?? "",
    },
  });
  return client;
}

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: env.MINIO_BUCKET }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket: env.MINIO_BUCKET }));
  }
  bucketEnsured = true;
}

export async function putS3Object(key: string, filePath: string): Promise<void> {
  await ensureBucket();
  const { size } = await stat(filePath);
  await s3().send(
    new PutObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: "audio/mpeg",
      ContentLength: size,
    }),
  );
}

export async function getS3ObjectStream(key: string): Promise<NodeJS.ReadableStream> {
  const response = await s3().send(new GetObjectCommand({ Bucket: env.MINIO_BUCKET, Key: key }));
  if (!response.Body) throw new Error(`stored object ${key} has no body`);
  return response.Body as NodeJS.ReadableStream;
}
