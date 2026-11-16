import path from "node:path";
import { describe, expect, it } from "vitest";
import { InvalidStorageKeyError, isValidStorageKey, resolveKeyPath, splitPrefix } from "./keys.js";

const ROOT = path.resolve("stems-root");

describe("resolveKeyPath", () => {
  it("maps a stem key below the root", () => {
    expect(resolveKeyPath(ROOT, "vocals/abc.mp3")).toBe(path.join(ROOT, "vocals", "abc.mp3"));
  });

  it.each([
    "../secret.txt",
    "vocals/../../secret.txt",
    "vocals/./abc.mp3",
    "/etc/passwd",
    "C:/Windows/win.ini",
    String.raw`vocals\..\..\x`,
    "vocals//abc.mp3",
    "vocals/abc.mp3/",
    "",
    "vocals/a b.mp3",
    "vocals/abc.mp3\u0000",
  ])("rejects %j", (key) => {
    expect(isValidStorageKey(key)).toBe(false);
    expect(() => resolveKeyPath(ROOT, key)).toThrow(InvalidStorageKeyError);
  });
});

describe("splitPrefix", () => {
  it.each([
    ["vocals/", { dir: "vocals/", namePrefix: "" }],
    ["vocals/ab", { dir: "vocals/", namePrefix: "ab" }],
    ["voc", { dir: "", namePrefix: "voc" }],
  ])("%s", (prefix, expected) => {
    expect(splitPrefix(prefix)).toEqual(expected);
  });
});
