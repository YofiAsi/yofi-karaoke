import type { FastifyInstance } from "fastify";
import { QueueState } from "@prisma/client";
import {
  AddQueueBodySchema,
  type ProcessingStep,
  type QueueItem as QueueItemView,
  type QueueView,
  PgNotifyChannels,
} from "@karaoke/shared";
import { prisma } from "../db.js";
import { requireUser } from "../auth/userCookie.js";
import { ytdlpInfo } from "../ytdlp.js";
import { enqueueProcessSong } from "../jobs/enqueueProcessSong.js";

export async function notify(channel: string, payload: object): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    channel,
    JSON.stringify(payload),
  );
}

export async function nextPosition(): Promise<number> {
  const agg = await prisma.queueItem.aggregate({ _max: { position: true } });
  return (agg._max.position ?? 0) + 1;
}

async function queueView(): Promise<QueueView> {
  const items = await prisma.queueItem.findMany({
    where: {
      state: {
        in: [QueueState.queued, QueueState.processing, QueueState.ready],
      },
    },
    orderBy: { position: "asc" },
    include: {
      song: true,
      requestedByUser: true,
    },
  });

  const songIds = items.map((i) => i.songId);
  const jobs = songIds.length
    ? await prisma.processingJob.findMany({
        where: { songId: { in: songIds } },
        orderBy: { startedAt: "desc" },
      })
    : [];
  const jobBySong = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (!jobBySong.has(j.songId)) jobBySong.set(j.songId, j);
  }

  const current = items.find((i) => i.state === QueueState.ready) ?? null;
  const currentId = current?.id ?? null;

  const toView = (i: (typeof items)[number]): QueueItemView => {
    const job = jobBySong.get(i.songId);
    return {
      id: i.id,
      song: {
        id: i.song.id,
        youtubeVideoId: i.song.youtubeVideoId,
        title: i.song.title,
        artist: i.song.artist,
        channel: i.song.channel,
        durationSeconds: i.song.durationSeconds,
        thumbnailUrl: i.song.thumbnailUrl,
        hasInstrumental: !!i.song.instrumentalObjectKey,
        hasLyrics: !!i.song.lyricsLrc,
      },
      requestedByUserId: i.requestedByUserId,
      requestedByUserName: i.requestedByUser.name,
      position: i.position,
      state: i.state as QueueItemView["state"],
      progress: job
        ? {
            step: job.step as ProcessingStep,
            progressPct: job.progressPct,
            errorMessage: job.errorMessage ?? null,
          }
        : null,
    };
  };

  return {
    current: current ? toView(current) : null,
    upcoming: items.filter((i) => i.id !== currentId).map(toView),
  };
}

export async function registerQueueRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/queue", {
    schema: { body: AddQueueBodySchema },
    handler: async (req, reply) => {
      const user = await requireUser(req);
      const { youtubeVideoId } = req.body as { youtubeVideoId: string };

      let song = await prisma.song.findUnique({ where: { youtubeVideoId } });
      let needsJob = false;

      if (!song) {
        const info = await ytdlpInfo(youtubeVideoId);
        const duration = Math.round(info.duration ?? 0);
        const thumb =
          info.thumbnail ??
          (info.thumbnails?.[info.thumbnails.length - 1]?.url ?? "");
        song = await prisma.song.create({
          data: {
            youtubeVideoId,
            title: info.title ?? youtubeVideoId,
            artist: info.artist ?? info.uploader ?? info.channel ?? "Unknown",
            channel: info.channel ?? info.uploader ?? "Unknown",
            durationSeconds: duration,
            thumbnailUrl: thumb,
          },
        });
        needsJob = true;
      } else if (!song.instrumentalObjectKey) {
        const hasOpenJob = await prisma.processingJob.findFirst({
          where: { songId: song.id, step: { notIn: ["done", "error"] } },
        });
        needsJob = !hasOpenJob;
      }

      const activeItem = await prisma.queueItem.findFirst({
        where: { songId: song.id, state: { in: [QueueState.queued, QueueState.processing, QueueState.ready] } },
      });
      if (activeItem) {
        return reply.code(409).send({ error: "already_queued" });
      }

      const initialState: QueueState = song.instrumentalObjectKey
        ? QueueState.ready
        : QueueState.processing;

      const position = await nextPosition();
      const queueItem = await prisma.queueItem.create({
        data: {
          songId: song.id,
          requestedByUserId: user.id,
          position,
          state: initialState,
        },
      });

      if (needsJob) {
        await prisma.processingJob.create({
          data: { songId: song.id, step: "pending", progressPct: 0 },
        });
        await enqueueProcessSong(song.id);
      }

      await notify(PgNotifyChannels.queueUpdated, { reason: "add", queueItemId: queueItem.id });

      return reply.code(201).send({
        queueItemId: queueItem.id,
        songId: song.id,
        state: initialState,
      });
    },
  });

  app.get("/api/queue", async (_req, reply) => {
    const view = await queueView();
    return reply.send(view);
  });
}
