import type { FastifyInstance } from "fastify";
import { QueueState } from "@prisma/client";
import {
  SeekBodySchema,
  PositionBodySchema,
  PgNotifyChannels,
  SocketEvents,
  type PlaybackStateView,
} from "@karaoke/shared";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { requireCurrentHost } from "../auth/requireCurrentHost.js";
import { getIO } from "../sockets/index.js";
import * as playerService from "../player/playerService.js";

async function notifyPlaybackState(): Promise<void> {
  const state = await prisma.playbackState.findUniqueOrThrow({ where: { id: 1 } });
  const payload: PlaybackStateView = {
    currentQueueItemId: state.currentQueueItemId ?? null,
    positionSeconds: state.positionSeconds,
    isPlaying: state.isPlaying,
    hostUserId: state.hostUserId ?? null,
    playerUserId: state.playerUserId ?? null,
  };
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    PgNotifyChannels.playbackState,
    JSON.stringify(payload),
  );
}

async function notifyQueueUpdated(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    PgNotifyChannels.queueUpdated,
    JSON.stringify({ reason: "skip" }),
  );
}

export async function registerPlaybackRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/playback", async (_req, reply) => {
    const state = await prisma.playbackState.findUniqueOrThrow({ where: { id: 1 } });
    const payload: PlaybackStateView = {
      currentQueueItemId: state.currentQueueItemId ?? null,
      positionSeconds: state.positionSeconds,
      isPlaying: state.isPlaying,
      hostUserId: state.hostUserId ?? null,
      playerUserId: state.playerUserId ?? null,
    };
    return reply.send(payload);
  });

  app.post("/api/playback/play", async (req, reply) => {
    await requireCurrentHost(req);
    await prisma.playbackState.update({
      where: { id: 1 },
      data: { isPlaying: true },
    });
    notifyPlaybackState().catch((err) => req.log.error({ err }, "notifyPlaybackState failed"));
    return reply.code(204).send();
  });

  // POST /api/playback/pause — host only
  app.post("/api/playback/pause", async (req, reply) => {
    await requireCurrentHost(req);
    await prisma.playbackState.update({
      where: { id: 1 },
      data: { isPlaying: false },
    });
    notifyPlaybackState().catch((err) => req.log.error({ err }, "notifyPlaybackState failed"));
    return reply.code(204).send();
  });

  // POST /api/playback/skip — host only
  app.post("/api/playback/skip", async (req, reply) => {
    await requireCurrentHost(req);

    const current = await prisma.playbackState.findUniqueOrThrow({ where: { id: 1 } });

    // Mark current item as played
    if (current.currentQueueItemId) {
      await prisma.queueItem.update({
        where: { id: current.currentQueueItemId },
        data: { state: QueueState.played, playedAt: new Date() },
      });
    }

    // Find next ready item (2.16: skip-if-not-ready — only state=ready items are candidates)
    const nextItem = await prisma.queueItem.findFirst({
      where: { state: QueueState.ready },
      orderBy: { position: "asc" },
    });

    await prisma.playbackState.update({
      where: { id: 1 },
      data: {
        currentQueueItemId: nextItem?.id ?? null,
        positionSeconds: 0,
        isPlaying: nextItem ? true : false,
      },
    });

    notifyPlaybackState().catch((err) => req.log.error({ err }, "notifyPlaybackState failed"));
    notifyQueueUpdated().catch((err) => req.log.error({ err }, "notifyQueueUpdated failed"));

    return reply.code(204).send();
  });

  // POST /api/playback/previous — host only
  app.post("/api/playback/previous", async (req, reply) => {
    await requireCurrentHost(req);

    // Load last played item
    const lastPlayed = await prisma.queueItem.findFirst({
      where: { state: QueueState.played },
      orderBy: { playedAt: "desc" },
    });

    if (lastPlayed) {
      await prisma.queueItem.update({
        where: { id: lastPlayed.id },
        data: { state: QueueState.ready },
      });
      await prisma.playbackState.update({
        where: { id: 1 },
        data: {
          currentQueueItemId: lastPlayed.id,
          positionSeconds: 0,
          isPlaying: true,
        },
      });
      notifyPlaybackState().catch((err) => req.log.error({ err }, "notifyPlaybackState failed"));
      notifyQueueUpdated().catch((err) => req.log.error({ err }, "notifyQueueUpdated failed"));
    }

    return reply.code(204).send();
  });

  // POST /api/playback/seek — host only
  app.post("/api/playback/seek", {
    schema: { body: SeekBodySchema },
    handler: async (req, reply) => {
      await requireCurrentHost(req);
      const { positionSeconds } = req.body as { positionSeconds: number };
      await prisma.playbackState.update({
        where: { id: 1 },
        data: { positionSeconds },
      });
      notifyPlaybackState().catch((err) => req.log.error({ err }, "notifyPlaybackState failed"));
      return reply.code(204).send();
    },
  });

  // POST /api/playback/position — player only (1Hz tick)
  app.post("/api/playback/position", {
    schema: { body: PositionBodySchema },
    handler: async (req, reply) => {
      const user = await requireUser(req);
      const playback = await prisma.playbackState.findUnique({ where: { id: 1 } });
      if (playback?.playerUserId !== user.id) {
        const err = new Error("forbidden");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      const { positionSeconds } = req.body as { positionSeconds: number };
      await prisma.playbackState.update({
        where: { id: 1 },
        data: { positionSeconds },
      });
      getIO().emit(SocketEvents.playbackTick, { positionSeconds });
      return reply.code(204).send();
    },
  });

  // POST /api/player/claim — any authenticated user
  app.post("/api/player/claim", async (req, reply) => {
    const user = await requireUser(req);
    const result = await playerService.claim(user.id);
    return reply.send({
      playerUserId: result.userId,
      playerUserName: result.userName,
    });
  });

  // POST /api/player/release — any authenticated user
  app.post("/api/player/release", async (req, reply) => {
    const user = await requireUser(req);
    await playerService.release(user.id);
    return reply.code(204).send();
  });

  // POST /api/player/heartbeat — any authenticated user
  app.post("/api/player/heartbeat", async (req, reply) => {
    const user = await requireUser(req);
    await playerService.heartbeat(user.id);
    return reply.code(204).send();
  });
}
