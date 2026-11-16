// Host lyrics routes in library.ts against a mocked song table, host check and job queue.
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SONG = "00000000-0000-4000-8000-0000000000a1";
const STORED_TIMINGS = [{ start: 1, end: 2, words: [{ text: "old", start: 1, end: 1.8 }] }];

const { state, enqueueRefetchLyrics, notify } = vi.hoisted(() => ({
  state: {
    isHost: true,
    songs: new Map<string, Record<string, unknown>>(),
    findManyWhere: null as unknown,
  },
  enqueueRefetchLyrics: vi.fn(async () => undefined),
  notify: vi.fn(async () => undefined),
}));

vi.mock("../db.js", () => ({
  prisma: {
    song: {
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const song = state.songs.get(where.id);
        if (!song) return { count: 0 };
        Object.assign(song, data);
        return { count: 1 };
      },
      findMany: async ({ where }: { where: unknown }) => {
        state.findManyWhere = where;
        return [{ id: SONG }];
      },
      findUnique: async ({ where }: { where: { id: string } }) => state.songs.get(where.id) ?? null,
    },
  },
}));
vi.mock("../auth/userCookie.js", () => ({ requireUser: async () => ({ id: "u" }) }));
vi.mock("../auth/requireCurrentHost.js", () => ({
  requireCurrentHost: async () => {
    if (!state.isHost) throw Object.assign(new Error("forbidden"), { statusCode: 403 });
  },
}));
vi.mock("../jobs/enqueueRefetchLyrics.js", () => ({ enqueueRefetchLyrics }));
vi.mock("../playback/notify.js", () => ({ notify }));
vi.mock("../queue/addition.js", () => ({ queueSong: vi.fn() }));

import { MAX_MANUAL_LYRICS_CHARS, registerLibraryRoutes } from "./library.js";

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err, _req, reply) => {
    const error = err as Error & { statusCode?: number };
    reply.code(error.statusCode ?? 500).send({ error: error.message });
  });
  await registerLibraryRoutes(app);
  return app;
}

async function paste(text: unknown, songId = SONG) {
  const app = await buildApp();
  return app.inject({ method: "POST", url: `/api/songs/${songId}/lyrics/manual`, payload: { text } });
}

beforeEach(() => {
  state.isHost = true;
  state.songs = new Map([[SONG, { id: SONG, lyricsLrc: "[00:01.00]old", lyricsPlain: "old", lyricsWordTimings: STORED_TIMINGS, lyricsSource: "lrclib", lyricsMissReason: null, lyricsOffsetMs: 0 }]]);
  enqueueRefetchLyrics.mockClear();
  notify.mockClear();
});

describe("POST /api/songs/:songId/lyrics/manual", () => {
  it("stores pasted text as manual plain lyrics and enqueues alignment", async () => {
    const res = await paste("שורה ראשונה\r\nשורה שנייה\r\n\r\n\r\n\r\nפזמון");
    expect(res.statusCode).toBe(202);
    expect(state.songs.get(SONG)).toMatchObject({
      lyricsPlain: "שורה ראשונה\nשורה שנייה\n\nפזמון",
      lyricsLrc: null,
      lyricsWordTimings: Prisma.DbNull,
      lyricsSource: "manual",
      lyricsMissReason: null,
    });
    expect(enqueueRefetchLyrics).toHaveBeenCalledWith([SONG]);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("is host only", async () => {
    state.isHost = false;
    expect((await paste("words")).statusCode).toBe(403);
    expect(enqueueRefetchLyrics).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized text", async () => {
    expect((await paste("   ")).statusCode).toBe(400);
    expect((await paste("x".repeat(MAX_MANUAL_LYRICS_CHARS + 1))).statusCode).toBe(400);
    expect(enqueueRefetchLyrics).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown song", async () => {
    expect((await paste("words", "00000000-0000-4000-8000-0000000000ff")).statusCode).toBe(404);
  });
});

describe("lyrics source and refetch missing", () => {
  it("returns the source with the lyrics", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/api/songs/${SONG}/lyrics` });
    expect(res.json()).toMatchObject({ source: "lrclib", lrc: "[00:01.00]old" });
  });

  it("returns stored word timings beside the LRC text", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/api/songs/${SONG}/lyrics` });
    expect(res.json().wordTimings).toEqual(STORED_TIMINGS);
  });

  it("returns no word timings when they are malformed or the song has no synced lyrics", async () => {
    const app = await buildApp();
    state.songs.get(SONG)!.lyricsWordTimings = [{ start: 2, end: 1, words: [] }];
    expect((await app.inject({ method: "GET", url: `/api/songs/${SONG}/lyrics` })).json().wordTimings).toBeNull();
    Object.assign(state.songs.get(SONG)!, { lyricsLrc: null, lyricsWordTimings: STORED_TIMINGS });
    expect((await app.inject({ method: "GET", url: `/api/songs/${SONG}/lyrics` })).json().wordTimings).toBeNull();
  });

  it("refetches every song without synced lyrics", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/songs/lyrics/refetch-missing" });
    expect(res.statusCode).toBe(202);
    expect(state.findManyWhere).toEqual({ lyricsLrc: null });
  });
});
