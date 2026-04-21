import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getObjectStream, statObject } from "../minio.js";

const ParamsSchema = z.object({ songId: z.string().uuid() });
const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

export async function registerAudioRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audio/:songId", {
    schema: { params: ParamsSchema },
    handler: async (req, reply) => {
      const { songId } = req.params as { songId: string };

      const song = await prisma.song.findUnique({ where: { id: songId } });
      if (!song || !song.instrumentalObjectKey) {
        return reply.code(404).send({ error: "not_ready" });
      }
      const key = song.instrumentalObjectKey;

      const head = await statObject(key);
      const total = head.contentLength;
      const rangeHeader = req.headers.range;
      const match = typeof rangeHeader === "string" ? RANGE_RE.exec(rangeHeader) : null;

      if (!match) {
        const { body } = await getObjectStream(key);
        reply
          .header("Content-Type", head.contentType)
          .header("Content-Length", String(total))
          .header("Accept-Ranges", "bytes")
          .header("Cache-Control", "private, max-age=0, must-revalidate");
        return reply.send(body);
      }

      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : total - 1;

      if (isNaN(start) || isNaN(end) || start > end || end >= total) {
        return reply
          .code(416)
          .header("Content-Range", `bytes */${total}`)
          .send();
      }

      const { body } = await getObjectStream(key, { start, end });
      reply
        .code(206)
        .header("Content-Type", head.contentType)
        .header("Content-Length", String(end - start + 1))
        .header("Content-Range", `bytes ${start}-${end}/${total}`)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "private, max-age=0, must-revalidate");
      return reply.send(body);
    },
  });
}
