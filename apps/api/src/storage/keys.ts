/* Maps storage keys to paths below a root folder, rejecting anything that could escape it. */
import path from "node:path";

const KEY_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`invalid storage key: ${JSON.stringify(key)}`);
    this.name = "InvalidStorageKeyError";
  }
}

function hasDotSegment(key: string): boolean {
  return key.split("/").some((segment) => segment === "." || segment === "..");
}

export function isValidStorageKey(key: string): boolean {
  return KEY_RE.test(key) && !hasDotSegment(key);
}

export function resolveKeyPath(root: string, key: string): string {
  if (!isValidStorageKey(key)) throw new InvalidStorageKeyError(key);
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...key.split("/"));
  if (!resolved.startsWith(base + path.sep)) throw new InvalidStorageKeyError(key);
  return resolved;
}

export function splitPrefix(prefix: string): { dir: string; namePrefix: string } {
  const slash = prefix.lastIndexOf("/");
  return { dir: prefix.slice(0, slash + 1), namePrefix: prefix.slice(slash + 1) };
}
