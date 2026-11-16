import { z } from "zod";
import { ANY_ORIGIN, parseOriginList } from "./auth/corsPolicy.js";

const DEV_SESSION_SECRET = "dev-only-session-secret-not-for-production";
const DEV_CORS_ORIGIN = "http://localhost:3000,http://127.0.0.1:3000";
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  STORAGE_DRIVER: z.enum(["minio", "fs"]).default("minio"),
  STORAGE_DIR: z.string().min(1).optional(),
  MINIO_ENDPOINT: z.string().default("minio:9000"),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET: z.string().default("karaoke"),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  HOST_USER_NAME: z.string().default("Host"),
  HOST_PIN: z.string().min(6).max(64),
  HOST_STALE_SECONDS: z.coerce.number().int().positive().default(30),
  PLAYER_STALE_SECONDS: z.coerce.number().int().positive().default(20),
  SESSION_SECRET: z.string().min(1).optional(),
  YTDLP_BIN: z.string().default("yt-dlp"),
  YTDLP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  YTDLP_JS_RUNTIMES: z.string().min(1).optional(),
  COOKIE_NAME: z.string().default("karaoke_uid"),
  CORS_ORIGIN: z.string().optional(),
  MAX_ACTIVE_ITEMS_PER_USER: z.coerce.number().int().positive().default(5),
});

type RawEnv = z.infer<typeof RawEnvSchema>;

function isWeakProductionSecret(raw: RawEnv): boolean {
  const secret = raw.SESSION_SECRET ?? "";
  return secret.length < MIN_PRODUCTION_SECRET_LENGTH;
}

function allowsAnyOrigin(raw: RawEnv): boolean {
  return parseOriginList(raw.CORS_ORIGIN ?? "").includes(ANY_ORIGIN);
}

function missingStorageSettings(raw: RawEnv): string[] {
  if (raw.STORAGE_DRIVER === "fs") return raw.STORAGE_DIR ? [] : ["STORAGE_DIR"];
  const required = ["MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"] as const;
  return required.filter((name) => !raw[name]);
}

function requireStorageSettings(raw: RawEnv, ctx: z.RefinementCtx): void {
  for (const name of missingStorageSettings(raw)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [name],
      message: `${name} is required when STORAGE_DRIVER=${raw.STORAGE_DRIVER}`,
    });
  }
}

function enforceProductionRules(raw: RawEnv, ctx: z.RefinementCtx): void {
  if (raw.NODE_ENV !== "production") return;
  if (isWeakProductionSecret(raw)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message: `SESSION_SECRET must be set to at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
    });
  }
  if (allowsAnyOrigin(raw)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ORIGIN"],
      message: "CORS_ORIGIN must list explicit origins in production; * is not allowed",
    });
  }
}

function defaultCorsOrigin(raw: RawEnv): string {
  return raw.NODE_ENV === "production" ? "" : DEV_CORS_ORIGIN;
}

function applyDefaults(raw: RawEnv) {
  return {
    ...raw,
    SESSION_SECRET: raw.SESSION_SECRET ?? DEV_SESSION_SECRET,
    CORS_ORIGINS: parseOriginList(raw.CORS_ORIGIN ?? defaultCorsOrigin(raw)),
  };
}

const EnvSchema = RawEnvSchema.superRefine(requireStorageSettings)
  .superRefine(enforceProductionRules)
  .transform(applyDefaults);

export function parseEnv(source: Record<string, string | undefined>) {
  return EnvSchema.parse(source);
}

export const env = parseEnv(process.env);
export type Env = typeof env;
