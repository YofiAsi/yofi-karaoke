import { describe, expect, it } from "vitest";
import { parseStorageConfig } from "./config.js";

describe("parseStorageConfig", () => {
  it("defaults to minio", () => {
    expect(parseStorageConfig({}).STORAGE_DRIVER).toBe("minio");
  });

  it("accepts fs with a folder", () => {
    expect(parseStorageConfig({ STORAGE_DRIVER: "fs", STORAGE_DIR: "C:\stems" })).toEqual({
      STORAGE_DRIVER: "fs",
      STORAGE_DIR: "C:\stems",
    });
  });

  it("requires STORAGE_DIR for fs", () => {
    expect(() => parseStorageConfig({ STORAGE_DRIVER: "fs" })).toThrow(/STORAGE_DIR/);
  });

  it("rejects unknown drivers", () => {
    expect(() => parseStorageConfig({ STORAGE_DRIVER: "s4" })).toThrow();
  });
});
