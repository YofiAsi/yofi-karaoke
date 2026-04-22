import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "./userCookie.js";

export async function requireCurrentHost(req: FastifyRequest): Promise<void> {
  const user = await requireUser(req);
  const playback = await prisma.playbackState.findUnique({ where: { id: 1 } });
  if (!user.isHost || playback?.hostUserId !== user.id) {
    const err = new Error("forbidden");
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
}
