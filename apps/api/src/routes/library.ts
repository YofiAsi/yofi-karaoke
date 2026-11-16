import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { PgNotifyChannels, SongSchema } from "@karaoke/shared";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { requireCurrentHost } from "../auth/requireCurrentHost.js";
import { enqueueRefetchLyrics } from "../jobs/enqueueRefetchLyrics.js";
import { notify } from "../playback/notify.js";
import { queueSong } from "../queue/addition.js";

const MISSING_LYRICS_REFETCH_SPACING_MS = 20_000;
const MAX_LYRICS_OFFSET_MS = 30_000;

const LyricsOffsetBodySchema = z.object({
  offsetMs: z.number().int().min(-MAX_LYRICS_OFFSET_MS).max(MAX_LYRICS_OFFSET_MS),
});

const LibraryQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const RequeueParamsSchema = z.object({
  songId: z.string().uuid(),
});

const SongParamsSchema = z.object({
  songId: z.string().uuid(),
});

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/songs/:songId/lyrics", {
    schema: { params: SongParamsSchema },
    handler: async (req, reply) => {
      const { songId } = req.params as z.infer<typeof SongParamsSchema>;
      const song = await prisma.song.findUnique({ where: { id: songId } });
      if (!song) {
        return reply.code(404).send({ error: "song_not_found" });
      }
      return reply.send({
        lrc: song.lyricsLrc ?? null,
        plain: song.lyricsPlain ?? null,
        offsetMs: song.lyricsOffsetMs,
        source: song.lyricsSource ?? null,
        missReason: song.lyricsMissReason ?? null,
      });
    },
  });

  app.post("/api/songs/:songId/lyrics/refetch", {
    schema: { params: SongParamsSchema },
    handler: async (req, reply) => {
      await requireCurrentHost(req);
      const { songId } = req.params as z.infer<typeof SongParamsSchema>;
      const song = await prisma.song.findUnique({ where: { id: songId }, select: { id: true } });
      if (!song) {
        return reply.code(404).send({ error: "song_not_found" });
      }
      await enqueueRefetchLyrics([song.id]);
      return reply.code(202).send({ enqueued: 1 });
    },
  });

  app.post("/api/songs/lyrics/refetch-missing", async (req, reply) => {
    await requireCurrentHost(req);
    const songs = await prisma.song.findMany({
      where: { lyricsSource: "none" },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    await enqueueRefetchLyrics(
      songs.map((s) => s.id),
      MISSING_LYRICS_REFETCH_SPACING_MS,
    );
    return reply.code(202).send({ enqueued: songs.length });
  });

  app.post("/api/songs/:songId/lyrics/offset", {
    schema: { params: SongParamsSchema, body: LyricsOffsetBodySchema },
    handler: async (req, reply) => {
      await requireCurrentHost(req);
      const { songId } = req.params as z.infer<typeof SongParamsSchema>;
      const { offsetMs } = req.body as z.infer<typeof LyricsOffsetBodySchema>;
      const updated = await prisma.song.updateMany({
        where: { id: songId },
        data: { lyricsOffsetMs: offsetMs },
      });
      if (updated.count === 0) {
        return reply.code(404).send({ error: "song_not_found" });
      }
      await notify(PgNotifyChannels.queueUpdated, { reason: "lyrics_offset", songId });
      return reply.send({ offsetMs });
    },
  });

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
        hasLyrics: !!(s.lyricsLrc || s.lyricsPlain),
        hasVocals: !!s.vocalsObjectKey,
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

      const queueItem = await queueSong(song, user.id);

      await notify(PgNotifyChannels.queueUpdated, { reason: "requeue", queueItemId: queueItem.id });

      return reply.code(201).send({
        queueItemId: queueItem.id,
        songId: song.id,
        state: queueItem.state,
      });
    },
  });
}
