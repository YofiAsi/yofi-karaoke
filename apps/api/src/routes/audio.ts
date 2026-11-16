import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { streamAudioObject } from "./audioStream.js";

const ParamsSchema = z.object({ songId: z.string().uuid() });

async function loadStemKeys(songId: string) {
  return prisma.song.findUnique({
    where: { id: songId },
    select: { instrumentalObjectKey: true, vocalsObjectKey: true },
  });
}

export async function registerAudioRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audio/:songId", {
    schema: { params: ParamsSchema },
    handler: async (req, reply) => {
      const { songId } = req.params as { songId: string };
      const song = await loadStemKeys(songId);
      if (!song?.instrumentalObjectKey) {
        return reply.code(404).send({ error: "not_ready" });
      }
      return streamAudioObject(req, reply, song.instrumentalObjectKey);
    },
  });

  app.get("/api/audio/:songId/vocals", {
    schema: { params: ParamsSchema },
    handler: async (req, reply) => {
      const { songId } = req.params as { songId: string };
      const song = await loadStemKeys(songId);
      if (!song?.instrumentalObjectKey) {
        return reply.code(404).send({ error: "not_ready" });
      }
      if (!song.vocalsObjectKey) {
        return reply.code(404).send({ error: "no_vocals" });
      }
      return streamAudioObject(req, reply, song.vocalsObjectKey);
    },
  });
}
