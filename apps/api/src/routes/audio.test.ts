import { Readable } from "node:stream";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockStat, mockGet } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockStat: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: { song: { findUnique: mockFindUnique } } }));
vi.mock("../minio.js", () => ({
  statObject: mockStat,
  getObjectStream: mockGet,
  isMissingObjectError: (err: { name?: string }) => err?.name === "NoSuchKey",
}));

import { registerAudioRoutes } from "./audio.js";
import { parseRange } from "./audioStream.js";

const SONG_ID = "6f1c2b9e-1d2a-4c3b-9a8e-0f1e2d3c4b5a";
const BYTES = Buffer.from("0123456789");

describe("parseRange", () => {
  it.each([
    [undefined, { kind: "full" }],
    ["items=0-1", { kind: "full" }],
    ["bytes=0-1,4-5", { kind: "full" }],
    ["bytes=-", { kind: "full" }],
    ["bytes=0-4", { kind: "partial", start: 0, end: 4 }],
    ["bytes=5-", { kind: "partial", start: 5, end: 9 }],
    ["bytes=8-100", { kind: "partial", start: 8, end: 9 }],
    ["bytes=-3", { kind: "partial", start: 7, end: 9 }],
    ["bytes=-100", { kind: "partial", start: 0, end: 9 }],
    ["bytes=-0", { kind: "unsatisfiable" }],
    ["bytes=10-", { kind: "unsatisfiable" }],
    ["bytes=5-2", { kind: "unsatisfiable" }],
  ])("%s", (header, expected) => {
    expect(parseRange(header, 10)).toEqual(expected);
  });

  it("treats any range on an empty object as unsatisfiable", () => {
    expect(parseRange("bytes=-1", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerAudioRoutes(app);
  return app;
}

function serveBytes() {
  mockStat.mockResolvedValue({ contentLength: BYTES.length, contentType: "audio/mpeg", etag: '"abc"' });
  mockGet.mockImplementation(async (_key: string, range?: { start: number; end: number }) => ({
    body: Readable.from([range ? BYTES.subarray(range.start, range.end + 1) : BYTES]),
  }));
}

describe("audio routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ instrumentalObjectKey: "instrumentals/x.mp3", vocalsObjectKey: "vocals/x.mp3" });
    serveBytes();
  });

  it("serves the instrumental with ETag and immutable caching", async () => {
    const app = await buildApp();
    const res = await app.inject({ url: `/api/audio/${SONG_ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("0123456789");
    expect(res.headers.etag).toBe('"abc"');
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(mockGet).toHaveBeenCalledWith("instrumentals/x.mp3", undefined);
  });

  it("serves a suffix range of the vocals stem", async () => {
    const app = await buildApp();
    const res = await app.inject({ url: `/api/audio/${SONG_ID}/vocals`, headers: { range: "bytes=-3" } });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe("789");
    expect(res.headers["content-range"]).toBe("bytes 7-9/10");
    expect(res.headers["content-length"]).toBe("3");
    expect(mockGet).toHaveBeenCalledWith("vocals/x.mp3", { start: 7, end: 9 });
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const app = await buildApp();
    const res = await app.inject({ url: `/api/audio/${SONG_ID}`, headers: { range: "bytes=20-" } });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */10");
  });

  it("returns no_vocals when the song has no vocals stem", async () => {
    mockFindUnique.mockResolvedValue({ instrumentalObjectKey: "instrumentals/x.mp3", vocalsObjectKey: null });
    const app = await buildApp();
    const res = await app.inject({ url: `/api/audio/${SONG_ID}/vocals` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no_vocals" });
  });

  it("returns not_ready before processing finishes", async () => {
    mockFindUnique.mockResolvedValue(null);
    const app = await buildApp();
    for (const url of [`/api/audio/${SONG_ID}`, `/api/audio/${SONG_ID}/vocals`]) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_ready" });
    }
  });

  it("maps a missing object to 404", async () => {
    mockStat.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ url: `/api/audio/${SONG_ID}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "audio_missing" });
  });

  it("maps an object deleted between stat and get to 404", async () => {
    mockGet.mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    const app = await buildApp();
    const res = await app.inject({ url: `/api/audio/${SONG_ID}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "audio_missing" });
  });
});
