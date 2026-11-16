import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const DEFAULT_SEPARATE_PY = fileURLToPath(new URL("../python/separate.py", import.meta.url));

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")),
    STORAGE_DRIVER: z.enum(["minio", "fs"]).default("minio"),
    STORAGE_DIR: z.string().min(1).optional(),
    MINIO_ENDPOINT: z.string().optional(),
    MINIO_ACCESS_KEY: z.string().optional(),
    MINIO_SECRET_KEY: z.string().optional(),
    MINIO_BUCKET: z.string().default("karaoke"),
    MINIO_REGION: z.string().default("us-east-1"),
    MINIO_USE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    AUDIO_SEP_MODEL: z.string().default("UVR-MDX-NET-Inst_HQ_3.onnx"),
    AUDIO_SEP_MODEL_DIR: z.string().default("/app/models"),
    SEPARATOR_BACKEND: z.enum(["openvino", "cuda", "cpu"]).default("openvino"),
    PYTHON_BIN: z.string().default("python3"),
    SEPARATE_PY_PATH: z.string().default(DEFAULT_SEPARATE_PY),
    YTDLP_BIN: z.string().default("yt-dlp"),
    YTDLP_JS_RUNTIMES: z.string().optional(),
    WORKER_TMP_DIR: z.string().default(path.join(os.tmpdir(), "karaoke")),
    SEPARATE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    STEM_BITRATE: z
      .string()
      .regex(/^\d{2,3}k$/, "STEM_BITRATE must look like 192k")
      .default("192k"),
    LRCLIB_BASE_URL: z.string().url().default("https://lrclib.net"),
    LRCLIB_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    LRCLIB_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1_000),
    LRCLIB_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
    LYRICS_OVH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  })
  .superRefine(requireDriverSettings);

type RawEnv = {
  STORAGE_DRIVER: "minio" | "fs";
  STORAGE_DIR?: string;
  MINIO_ENDPOINT?: string;
  MINIO_ACCESS_KEY?: string;
  MINIO_SECRET_KEY?: string;
};

function missingDriverSettings(raw: RawEnv): string[] {
  if (raw.STORAGE_DRIVER === "fs") return raw.STORAGE_DIR ? [] : ["STORAGE_DIR"];
  const required = ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"] as const;
  return required.filter((name) => !raw[name]);
}

function requireDriverSettings(raw: RawEnv, ctx: z.RefinementCtx): void {
  for (const name of missingDriverSettings(raw)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [name],
      message: `${name} is required when STORAGE_DRIVER=${raw.STORAGE_DRIVER}`,
    });
  }
}

export function parseEnv(source: Record<string, string | undefined>) {
  return EnvSchema.parse(source);
}

export const env = parseEnv(process.env);
export type Env = typeof env;
