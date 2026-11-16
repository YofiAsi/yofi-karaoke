import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { putFsObject } from "./fsUpload.js";
import { resolveKeyPath, stemObjectKey } from "./keys.js";

let root: string;
let source: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "stems-"));
  source = path.join(root, "source.mp3");
  await writeFile(source, "first");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("stemObjectKey", () => {
  it("keeps the keys the api serves", () => {
    expect(stemObjectKey("instrumental", "abc")).toBe("instrumentals/abc.mp3");
    expect(stemObjectKey("vocals", "abc")).toBe("vocals/abc.mp3");
  });
});

describe("resolveKeyPath", () => {
  it.each(["../x.mp3", "vocals/../../x.mp3", "/abs.mp3", String.raw`vocals\..\x.mp3`, "vocals/"])("rejects %j", (key) => {
    expect(() => resolveKeyPath(root, key)).toThrow(/invalid storage key/);
  });
});

describe("putFsObject", () => {
  it("copies the file under its key and replaces an older copy", async () => {
    const key = stemObjectKey("vocals", "song-1");
    const target = await putFsObject(path.join(root, "store"), key, source);
    expect(target).toBe(path.join(root, "store", "vocals", "song-1.mp3"));
    await writeFile(source, "second");
    await putFsObject(path.join(root, "store"), key, source);
    expect(await readFile(target, "utf8")).toBe("second");
    expect(await readdir(path.dirname(target))).toEqual(["song-1.mp3"]);
  });

  it("refuses keys outside the folder", async () => {
    await expect(putFsObject(path.join(root, "store"), "../escape.mp3", source)).rejects.toThrow(/invalid storage key/);
  });
});
