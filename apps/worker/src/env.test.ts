import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://localhost/test";
process.env.STORAGE_DRIVER ??= "fs";
process.env.STORAGE_DIR ??= "stems";

const { parseEnv } = await import("./env.js");

const DB = { DATABASE_URL: "postgres://localhost:5432/karaoke" };

describe("worker env", () => {
  it("does not need MinIO settings with the folder driver", () => {
    const env = parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "C:/data/stems" });
    expect(env.STORAGE_DRIVER).toBe("fs");
    expect(env.STORAGE_DIR).toBe("C:/data/stems");
  });

  it("requires STORAGE_DIR with the folder driver", () => {
    expect(() => parseEnv({ ...DB, STORAGE_DRIVER: "fs" })).toThrow(/STORAGE_DIR is required/);
  });

  it("keeps requiring MinIO settings by default", () => {
    expect(() => parseEnv(DB)).toThrow(/MINIO_ACCESS_KEY is required/);
    const env = parseEnv({ ...DB, MINIO_ENDPOINT: "minio:9000", MINIO_ACCESS_KEY: "a", MINIO_SECRET_KEY: "b" });
    expect(env.STORAGE_DRIVER).toBe("minio");
  });

  it("points at the bundled GPU sidecar by default", () => {
    const env = parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" });
    expect(env.GPU_SIDECAR_PY_PATH.split(path.sep).join("/")).toMatch(/apps\/worker\/python\/gpu_sidecar\.py$/);
  });

  it("limits the words only transcription to 30 s by default and validates WORD_TIMINGS_TIMEOUT_MS", () => {
    const base = { ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" };
    expect(parseEnv(base).WORD_TIMINGS_TIMEOUT_MS).toBe(30_000);
    expect(parseEnv({ ...base, WORD_TIMINGS_TIMEOUT_MS: "15000" }).WORD_TIMINGS_TIMEOUT_MS).toBe(15_000);
    for (const bad of ["0", "999", "600001", "soon"]) expect(() => parseEnv({ ...base, WORD_TIMINGS_TIMEOUT_MS: bad })).toThrow();
  });

  it("runs four jobs at once by default and validates WORKER_CONCURRENCY", () => {
    const base = { ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" };
    expect(parseEnv(base).WORKER_CONCURRENCY).toBe(4);
    expect(parseEnv({ ...base, WORKER_CONCURRENCY: "2" }).WORKER_CONCURRENCY).toBe(2);
    for (const bad of ["0", "17", "1.5", "many"]) expect(() => parseEnv({ ...base, WORKER_CONCURRENCY: bad })).toThrow();
  });

  it("enables Tab4U with polite defaults and lets it be switched off", () => {
    const env = parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" });
    expect(env).toMatchObject({ LYRICS_TAB4U_ENABLED: true, TAB4U_MIN_INTERVAL_MS: 2_000, TAB4U_TIMEOUT_MS: 8_000 });
    expect(parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x", LYRICS_TAB4U_ENABLED: "false" }).LYRICS_TAB4U_ENABLED).toBe(false);
  });

  it("enables romaji for Japanese lyrics by default and lets it be switched off", () => {
    const base = { ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" };
    expect(parseEnv(base).LYRICS_ROMAJI_ENABLED).toBe(true);
    expect(parseEnv({ ...base, LYRICS_ROMAJI_ENABLED: "false" }).LYRICS_ROMAJI_ENABLED).toBe(false);
    expect(() => parseEnv({ ...base, LYRICS_ROMAJI_ENABLED: "yes" })).toThrow();
  });

  it("keeps transcription off unless asked for", () => {
    const env = parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" });
    expect(env.TRANSCRIBE_BACKEND).toBe("none");
    expect(parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x", TRANSCRIBE_BACKEND: "cuda" }).TRANSCRIBE_BACKEND).toBe("cuda");
    expect(() => parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x", TRANSCRIBE_BACKEND: "rocm" })).toThrow();
  });
});
