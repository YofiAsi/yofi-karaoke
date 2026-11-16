import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "./env.js";

export type StemKind = "instrumental" | "vocals";

const STEM_PREFIXES: Record<StemKind, string> = {
  instrumental: "instrumentals",
  vocals: "vocals",
};

const s3 = new S3Client({
  region: env.MINIO_REGION,
  endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
});

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.MINIO_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.MINIO_BUCKET }));
  }
  bucketEnsured = true;
}

export function stemObjectKey(kind: StemKind, songId: string): string {
  return `${STEM_PREFIXES[kind]}/${songId}.mp3`;
}

export async function uploadStem(
  kind: StemKind,
  songId: string,
  filePath: string,
): Promise<string> {
  await ensureBucket();
  const key = stemObjectKey(kind, songId);
  const { size } = await stat(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: "audio/mpeg",
      ContentLength: size,
    }),
  );
  return key;
}
