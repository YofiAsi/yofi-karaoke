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

  it("points at the bundled separate.py by default", () => {
    const env = parseEnv({ ...DB, STORAGE_DRIVER: "fs", STORAGE_DIR: "x" });
    expect(env.SEPARATE_PY_PATH.split(path.sep).join("/")).toMatch(/apps\/worker\/python\/separate\.py$/);
  });
});
