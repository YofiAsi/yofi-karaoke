/* Stem object keys and their mapping to files below a storage folder. */
import path from "node:path";

export type StemKind = "instrumental" | "vocals";

const STEM_PREFIXES: Record<StemKind, string> = {
  instrumental: "instrumentals",
  vocals: "vocals",
};

const KEY_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

export function stemObjectKey(kind: StemKind, songId: string): string {
  return `${STEM_PREFIXES[kind]}/${songId}.mp3`;
}

function hasDotSegment(key: string): boolean {
  return key.split("/").some((segment) => segment === "." || segment === "..");
}

export function resolveKeyPath(root: string, key: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...key.split("/"));
  if (!KEY_RE.test(key) || hasDotSegment(key) || !resolved.startsWith(base + path.sep)) {
    throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
  }
  return resolved;
}
