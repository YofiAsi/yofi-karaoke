import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  MINIO_ENDPOINT: z.string().default("minio:9000"),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET: z.string().default("karaoke"),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  HOST_USER_NAME: z.string().default("Host"),
  HOST_STALE_SECONDS: z.coerce.number().int().positive().default(30),
  PLAYER_STALE_SECONDS: z.coerce.number().int().positive().default(20),
  SESSION_SECRET: z.string().min(8).default("change-me-please-change-me"),
  YTDLP_BIN: z.string().default("yt-dlp"),
  YTDLP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  COOKIE_NAME: z.string().default("karaoke_uid"),
  CORS_ORIGIN: z.string().default("*"),
  PUBLIC_ORIGIN: z.string().default(""),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
  ...parsed,
  /**
   * Resolved CORS / Socket.IO origin.
   * PUBLIC_ORIGIN (Dokploy prod) wins when set; otherwise fall back to the
   * comma-separated CORS_ORIGIN (or "*" which becomes `true` for reflection).
   */
  CORS_ORIGIN: parsed.PUBLIC_ORIGIN.trim() !== "" ? parsed.PUBLIC_ORIGIN : parsed.CORS_ORIGIN,
};
export type Env = typeof env;
