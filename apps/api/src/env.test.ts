import { describe, it, expect, vi } from "vitest";

const BASE_ENV = vi.hoisted(() => {
  const base = {
    DATABASE_URL: "postgres://test",
    MINIO_ACCESS_KEY: "key",
    MINIO_SECRET_KEY: "secret",
    HOST_PIN: "432100",
  };
  Object.assign(process.env, base);
  return base;
});

import { parseEnv } from "./env.js";
import { resolveCorsOrigin, parseOriginList } from "./auth/corsPolicy.js";

const STRONG_SECRET = "s".repeat(32);

describe("parseEnv()", () => {
  it("requires HOST_PIN", () => {
    const { HOST_PIN: _omitted, ...withoutPin } = BASE_ENV;
    expect(() => parseEnv(withoutPin)).toThrow(/HOST_PIN/);
  });

  it("rejects a HOST_PIN shorter than 6 or longer than 64 characters", () => {
    expect(() => parseEnv({ ...BASE_ENV, HOST_PIN: "12345" })).toThrow(/HOST_PIN/);
    expect(() => parseEnv({ ...BASE_ENV, HOST_PIN: "9".repeat(65) })).toThrow(/HOST_PIN/);
    expect(parseEnv({ ...BASE_ENV, HOST_PIN: "9".repeat(64) }).HOST_PIN).toHaveLength(64);
  });

  it("uses a development secret and local origins outside production", () => {
    const env = parseEnv(BASE_ENV);
    expect(env.SESSION_SECRET.length).toBeGreaterThan(0);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  it("fails in production when SESSION_SECRET is missing", () => {
    expect(() => parseEnv({ ...BASE_ENV, NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });

  it("fails in production when SESSION_SECRET is shorter than 32 characters", () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, NODE_ENV: "production", SESSION_SECRET: "short-secret" }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("refuses a wildcard CORS_ORIGIN in production", () => {
    expect(() =>
      parseEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        SESSION_SECRET: STRONG_SECRET,
        CORS_ORIGIN: "https://a.example,*",
      }),
    ).toThrow(/CORS_ORIGIN/);
  });

  it("accepts a strong secret and an explicit origin list in production", () => {
    const env = parseEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SESSION_SECRET: STRONG_SECRET,
      CORS_ORIGIN: " https://a.example , https://b.example ",
    });
    expect(env.CORS_ORIGINS).toEqual(["https://a.example", "https://b.example"]);
  });

  it("defaults to same origin only in production", () => {
    const env = parseEnv({ ...BASE_ENV, NODE_ENV: "production", SESSION_SECRET: STRONG_SECRET });
    expect(env.CORS_ORIGINS).toEqual([]);
  });
});

describe("storage settings", () => {
  const { MINIO_ACCESS_KEY: _key, MINIO_SECRET_KEY: _secret, ...withoutMinio } = BASE_ENV;

  it("defaults to minio and requires its credentials", () => {
    expect(parseEnv(BASE_ENV).STORAGE_DRIVER).toBe("minio");
    expect(() => parseEnv(withoutMinio)).toThrow(/MINIO_ACCESS_KEY is required when STORAGE_DRIVER=minio/);
  });

  it("needs no MinIO settings with the folder driver", () => {
    const env = parseEnv({ ...withoutMinio, STORAGE_DRIVER: "fs", STORAGE_DIR: "C:/party/stems" });
    expect(env.STORAGE_DRIVER).toBe("fs");
    expect(env.STORAGE_DIR).toBe("C:/party/stems");
  });

  it("requires STORAGE_DIR with the folder driver", () => {
    expect(() => parseEnv({ ...withoutMinio, STORAGE_DRIVER: "fs" })).toThrow(/STORAGE_DIR is required/);
  });

  it("rejects unknown drivers", () => {
    expect(() => parseEnv({ ...BASE_ENV, STORAGE_DRIVER: "s4" })).toThrow(/STORAGE_DRIVER/);
  });
});

describe("resolveCorsOrigin()", () => {
  it("disables cross origin access for an empty list", () => {
    expect(resolveCorsOrigin([])).toBe(false);
  });

  it("returns the explicit list unchanged", () => {
    expect(resolveCorsOrigin(parseOriginList("https://a.example,https://b.example"))).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("reflects any origin only for the development wildcard", () => {
    expect(resolveCorsOrigin(["*"])).toBe(true);
  });
});
