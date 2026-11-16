// POST /api/playback/vocals against mocked users, playback row and queue item.
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ITEM = "00000000-0000-4000-8000-00000000000a";
const OTHER_ITEM = "00000000-0000-4000-8000-00000000000b";

const { state, notifyPlaybackState } = vi.hoisted(() => ({
  state: {
    user: { id: "guest", isHost: false },
    playback: { id: 1, currentQueueItemId: null as string | null, hostUserId: "host", vocalsGain: 0 },
    item: { id: "", state: "ready", requestedByUserId: "guest", song: { vocalsObjectKey: "vocals/x.mp3" as string | null } },
  },
  notifyPlaybackState: vi.fn(async () => undefined),
}));

vi.mock("../db.js", () => ({
  prisma: {
    playbackState: {
      findUnique: async () => ({ ...state.playback }),
      updateMany: async ({ where, data }: { where: { currentQueueItemId: string }; data: { vocalsGain: number } }) => {
        if (where.currentQueueItemId !== state.playback.currentQueueItemId) return { count: 0 };
        Object.assign(state.playback, data);
        return { count: 1 };
      },
    },
    queueItem: { findUnique: async () => ({ ...state.item }) },
  },
}));
vi.mock("../auth/userCookie.js", () => ({ requireUser: async () => state.user }));
vi.mock("../sockets/index.js", () => ({ getIO: () => ({ emit: vi.fn() }) }));
vi.mock("../player/playerService.js", () => ({}));
vi.mock("../playback/notify.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyPlaybackState,
}));

import { registerPlaybackRoutes } from "./playback.js";

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err, _req, reply) => {
    const error = err as Error & { statusCode?: number };
    reply.code(error.statusCode ?? 500).send({ error: error.message });
  });
  await registerPlaybackRoutes(app);
  return app;
}

async function postGain(body: object) {
  const app = await buildApp();
  return app.inject({ method: "POST", url: "/api/playback/vocals", payload: body });
}

beforeEach(() => {
  state.user = { id: "guest", isHost: false };
  state.playback = { id: 1, currentQueueItemId: ITEM, hostUserId: "host", vocalsGain: 0 };
  state.item = { id: ITEM, state: "ready", requestedByUserId: "guest", song: { vocalsObjectKey: "vocals/x.mp3" } };
  notifyPlaybackState.mockClear();
});

describe("POST /api/playback/vocals", () => {
  it("stores the requester's gain and broadcasts playback state", async () => {
    const res = await postGain({ gain: 0.4, queueItemId: ITEM });
    expect(res.statusCode).toBe(204);
    expect(state.playback.vocalsGain).toBe(0.4);
    expect(notifyPlaybackState).toHaveBeenCalledOnce();
  });

  it("lets the current host change the gain of someone else's song", async () => {
    state.user = { id: "host", isHost: true };
    expect((await postGain({ gain: 1, queueItemId: ITEM })).statusCode).toBe(204);
  });

  it("forbids other guests", async () => {
    state.user = { id: "stranger", isHost: false };
    const res = await postGain({ gain: 0.4, queueItemId: ITEM });
    expect(res.statusCode).toBe(403);
    expect(state.playback.vocalsGain).toBe(0);
  });

  it("returns 409 for a queue item that is not current", async () => {
    const res = await postGain({ gain: 0.4, queueItemId: OTHER_ITEM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_current" });
  });

  it("returns 409 when the song has no vocals stem", async () => {
    state.item.song.vocalsObjectKey = null;
    const res = await postGain({ gain: 0.4, queueItemId: ITEM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_vocals" });
  });

  it("validates the gain range", async () => {
    expect((await postGain({ gain: 1.5, queueItemId: ITEM })).statusCode).toBe(400);
    expect((await postGain({ gain: -0.1, queueItemId: ITEM })).statusCode).toBe(400);
  });
});
