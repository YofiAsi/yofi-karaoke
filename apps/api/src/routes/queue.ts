import type { FastifyInstance } from "fastify";
import {
  AddQueueBodySchema,
  MoveQueueItemBodySchema,
  QueueItemParamsSchema,
  type AddQueueBody,
  type MoveQueueItemBody,
  type QueueItemParams,
} from "@karaoke/shared";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { notifyQueueUpdated } from "../playback/notify.js";
import { findOrCreateSong, queueSong, reviveFailedItem, ensureProcessing } from "../queue/addition.js";
import { httpError } from "../queue/httpError.js";
import { loadActor, retryDenial } from "../queue/permissions.js";
import { moveQueueItem, removeQueueItem } from "../queue/management.js";
import { loadQueueView } from "../queue/queueView.js";

async function loadItemWithSong(queueItemId: string) {
  const item = await prisma.queueItem.findUnique({ where: { id: queueItemId }, include: { song: true } });
  if (!item) throw httpError(404, "not_found");
  return item;
}

export async function registerQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/queue", async (_req, reply) => reply.send(await loadQueueView()));

  app.post("/api/queue", {
    schema: { body: AddQueueBodySchema },
    handler: async (req, reply) => {
      const user = await requireUser(req);
      const { youtubeVideoId } = req.body as AddQueueBody;
      const song = await findOrCreateSong(youtubeVideoId);
      const item = await queueSong(song, user.id);
      await notifyQueueUpdated("add", { queueItemId: item.id });
      return reply.code(201).send({ queueItemId: item.id, songId: song.id, state: item.state });
    },
  });

  app.post("/api/queue/items/:queueItemId/retry", {
    schema: { params: QueueItemParamsSchema },
    handler: async (req, reply) => {
      const actor = await loadActor(req);
      const { queueItemId } = req.params as QueueItemParams;
      const { song, ...item } = await loadItemWithSong(queueItemId);
      const denial = retryDenial(actor, item);
      if (denial) throw denial;
      const revived = await reviveFailedItem(item, song);
      await ensureProcessing(song);
      await notifyQueueUpdated("retry", { queueItemId: item.id });
      return reply.send({ ok: true, state: revived.state });
    },
  });

  app.delete("/api/queue/items/:queueItemId", {
    schema: { params: QueueItemParamsSchema },
    handler: async (req, reply) => {
      const actor = await loadActor(req);
      const { queueItemId } = req.params as QueueItemParams;
      await removeQueueItem(actor, queueItemId);
      await notifyQueueUpdated("remove", { queueItemId });
      return reply.code(204).send();
    },
  });

  app.post("/api/queue/items/:queueItemId/move", {
    schema: { params: QueueItemParamsSchema, body: MoveQueueItemBodySchema },
    handler: async (req, reply) => {
      const actor = await loadActor(req);
      const { queueItemId } = req.params as QueueItemParams;
      const { direction } = req.body as MoveQueueItemBody;
      const moved = await moveQueueItem(actor, queueItemId, direction);
      if (moved) await notifyQueueUpdated("move", { queueItemId });
      return reply.send({ moved });
    },
  });
}
