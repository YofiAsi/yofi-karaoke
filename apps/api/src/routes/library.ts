import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { QueueState } from "@prisma/client";
import { PgNotifyChannels, SongSchema } from "@karaoke/shared";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { nextPosition, notify } from "./queue.js";

const LibraryQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const RequeueParamsSchema = z.object({
  songId: z.string().uuid(),
});

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  // 3.1 Library search — paginated, only songs with instrumentalObjectKey
  app.get("/api/library", {
    schema: {
      querystring: LibraryQuerySchema,
      response: {
        200: z.object({ items: z.array(SongSchema), total: z.number().int() }),
      },
    },
    handler: async (req, reply) => {
      const { q, limit, offset } = req.query as z.infer<typeof LibraryQuerySchema>;

      const where = {
        instrumentalObjectKey: { not: null as null },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { artist: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };

      const [songs, total] = await Promise.all([
        prisma.song.findMany({
          where,
          orderBy: [{ title: "asc" }, { artist: "asc" }],
          skip: offset,
          take: limit,
        }),
        prisma.song.count({ where }),
      ]);

      const items = songs.map((s) => ({
        id: s.id,
        youtubeVideoId: s.youtubeVideoId,
        title: s.title,
        artist: s.artist,
        channel: s.channel,
        durationSeconds: s.durationSeconds,
        thumbnailUrl: s.thumbnailUrl,
        hasInstrumental: true,
        hasLyrics: !!s.lyricsLrc,
      }));

      return reply.send({ items, total });
    },
  });

  // 3.2 Re-queue a library song — insert QueueItem state=ready directly, no job
  app.post("/api/library/:songId/requeue", {
    schema: { params: RequeueParamsSchema },
    handler: async (req, reply) => {
      const user = await requireUser(req);
      const { songId } = req.params as z.infer<typeof RequeueParamsSchema>;

      const song = await prisma.song.findUnique({ where: { id: songId } });
      if (!song) {
        return reply.code(404).send({ error: "song_not_found" });
      }
      if (!song.instrumentalObjectKey) {
        return reply.code(409).send({ error: "song_not_processed" });
      }

      // Dedupe: reject if this song already has an active (non-played/skipped/failed) queue item
      const existing = await prisma.queueItem.findFirst({
        where: {
          songId: song.id,
          state: { in: [QueueState.queued, QueueState.processing, QueueState.ready] },
        },
      });
      if (existing) {
        return reply.code(409).send({ error: "already_queued", queueItemId: existing.id });
      }

      const position = await nextPosition();
      const queueItem = await prisma.queueItem.create({
        data: {
          songId: song.id,
          requestedByUserId: user.id,
          position,
          state: QueueState.ready,
        },
      });

      await notify(PgNotifyChannels.queueUpdated, { reason: "requeue", queueItemId: queueItem.id });

      return reply.code(201).send({
        queueItemId: queueItem.id,
        songId: song.id,
        state: QueueState.ready,
      });
    },
  });
}
