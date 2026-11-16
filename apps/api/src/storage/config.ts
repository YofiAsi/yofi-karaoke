/* Storage driver settings, read here until they move into env.ts. */
import { z } from "zod";

const StorageConfigSchema = z
  .object({
    STORAGE_DRIVER: z.enum(["minio", "fs"]).default("minio"),
    STORAGE_DIR: z.string().min(1).optional(),
  })
  .refine((c) => c.STORAGE_DRIVER !== "fs" || !!c.STORAGE_DIR, {
    path: ["STORAGE_DIR"],
    message: "STORAGE_DIR is required when STORAGE_DRIVER=fs",
  });

export type StorageConfig = z.infer<typeof StorageConfigSchema>;

export function parseStorageConfig(source: Record<string, string | undefined>): StorageConfig {
  return StorageConfigSchema.parse(source);
}
