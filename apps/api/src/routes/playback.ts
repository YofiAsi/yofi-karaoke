import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  SeekBodySchema,
  PositionBodySchema,
  PlaybackTransitionBodySchema,
  VocalsGainBodySchema,
  SocketEvents,
  type PlaybackTickEvent,
  type PlaybackTransitionBody,
  type PositionBody,
  type PlaybackTransitionResult,
  type VocalsGainBody,
} from "@karaoke/shared";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { requireCurrentHost } from "../auth/requireCurrentHost.js";
import { getIO } from "../sockets/index.js";
import * as playerService from "../player/playerService.js";
import {
  PLAYBACK_STATE_ID,
  loadPlaybackStateView,
  notifyPlaybackState,
  notifyQueueUpdated,
} from "../playback/notify.js";
import { advance, play, recordPosition, rewind } from "../playback/transitions.js";
import { loadCurrentForVocals, storeVocalsGain, vocalsGainDenial } from "../playback/vocals.js";
import { asAlreadyQueued, httpError } from "../queue/httpError.js";
import { loadActor } from "../queue/permissions.js";

async function requirePlayer(req: FastifyRequest): Promise<void> {
  const user = await requireUser(req);
  const playback = await prisma.playbackState.findUnique({ where: { id: PLAYBACK_STATE_ID } });
  if (playback?.playerUserId !== user.id) throw httpError(403, "forbidden");
}

function publishPlaybackState(req: FastifyRequest): void {
  notifyPlaybackState().catch((err) => req.log.error({ err }, "notifyPlaybackState failed"));
}

function publishTransition(req: FastifyRequest, result: PlaybackTransitionResult, reason: string): void {
  if (!result.changed) return;
  publishPlaybackState(req);
  notifyQueueUpdated(reason).catch((err) => req.log.error({ err }, "notifyQueueUpdated failed"));
}

function expectedItemId(req: FastifyRequest): string | null {
  return (req.body as PlaybackTransitionBody).expectedQueueItemId;
}

async function setIsPlaying(isPlaying: boolean): Promise<void> {
  await prisma.playbackState.update({ where: { id: PLAYBACK_STATE_ID }, data: { isPlaying } });
}

export async function registerPlaybackRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/playback", async (_req, reply) => reply.send(await loadPlaybackStateView()));

  app.post("/api/playback/play", async (req, reply) => {
    await requireCurrentHost(req);
    const result = await play();
    publishTransition(req, result, "play");
    return reply.send(result);
  });

  app.post("/api/playback/pause", async (req, reply) => {
    await requireCurrentHost(req);
    await setIsPlaying(false);
    publishPlaybackState(req);
    return reply.code(204).send();
  });

  app.post("/api/playback/skip", {
    schema: { body: PlaybackTransitionBodySchema },
    handler: async (req, reply) => {
      await requireCurrentHost(req);
      const result = await advance(expectedItemId(req));
      publishTransition(req, result, "skip");
      return reply.send(result);
    },
  });

  app.post("/api/playback/ended", {
    schema: { body: PlaybackTransitionBodySchema },
    handler: async (req, reply) => {
      await requirePlayer(req);
      const result = await advance(expectedItemId(req));
      publishTransition(req, result, "ended");
      return reply.send(result);
    },
  });

  app.post("/api/playback/previous", {
    schema: { body: PlaybackTransitionBodySchema },
    handler: async (req, reply) => {
      await requireCurrentHost(req);
      const result = await asAlreadyQueued(() => rewind(expectedItemId(req)));
      publishTransition(req, result, "previous");
      return reply.send(result);
    },
  });

  app.post("/api/playback/seek", {
    schema: { body: SeekBodySchema },
    handler: async (req, reply) => {
      await requireCurrentHost(req);
      const { positionSeconds } = req.body as { positionSeconds: number };
      await prisma.playbackState.update({ where: { id: PLAYBACK_STATE_ID }, data: { positionSeconds } });
      publishPlaybackState(req);
      return reply.code(204).send();
    },
  });

  app.post("/api/playback/position", {
    schema: { body: PositionBodySchema },
    handler: async (req, reply) => {
      await requirePlayer(req);
      const { queueItemId, positionSeconds } = req.body as PositionBody;
      if (await recordPosition(queueItemId, positionSeconds)) {
        const tick: PlaybackTickEvent = { queueItemId, positionSeconds, serverTimeMs: Date.now() };
        getIO().emit(SocketEvents.playbackTick, tick);
      }
      return reply.code(204).send();
    },
  });

  app.post("/api/playback/vocals", {
    schema: { body: VocalsGainBodySchema },
    handler: async (req, reply) => {
      const { gain, queueItemId } = req.body as VocalsGainBody;
      const [actor, current] = await Promise.all([loadActor(req), loadCurrentForVocals()]);
      const denial = vocalsGainDenial(actor, current, queueItemId);
      if (denial) throw denial;
      if (!(await storeVocalsGain(queueItemId, gain))) throw httpError(409, "not_current");
      publishPlaybackState(req);
      return reply.code(204).send();
    },
  });

  app.post("/api/player/claim", async (req, reply) => {
    const user = await requireUser(req);
    const result = await playerService.claim(user.id);
    return reply.send({ playerUserId: result.userId, playerUserName: result.userName });
  });

  app.post("/api/player/release", async (req, reply) => {
    const user = await requireUser(req);
    await playerService.release(user.id);
    return reply.code(204).send();
  });

  app.post("/api/player/heartbeat", async (req, reply) => {
    const user = await requireUser(req);
    await playerService.heartbeat(user.id);
    return reply.code(204).send();
  });
}
