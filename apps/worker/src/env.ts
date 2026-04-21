import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")),
  MINIO_ENDPOINT: z.string(),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET: z.string().default("karaoke"),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AUDIO_SEP_MODEL: z.string().default("UVR-MDX-NET-Inst_HQ_3.onnx"),
  OV_DEVICE: z.enum(["GPU", "CPU"]).default("GPU"),
  PYTHON_BIN: z.string().default("python3"),
  SEPARATE_PY_PATH: z.string().default("/app/apps/worker/python/separate.py"),
  WORKER_TMP_DIR: z.string().default("/tmp/karaoke"),
  SEPARATE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LRCLIB_BASE_URL: z.string().url().default("https://lrclib.net"),
  LRCLIB_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
