import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateUserBodySchema, UserSchema, PgNotifyChannels } from "@karaoke/shared";
import { prisma } from "../db.js";
import { setUserCookie, requireUser } from "../auth/userCookie.js";
import { claimOrConflict, heartbeat, isHostName } from "../host/hostService.js";

async function notifyHostChanged(hostUserId: string, hostUserName: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    PgNotifyChannels.hostChanged,
    JSON.stringify({ hostUserId, hostUserName }),
  );
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/users", {
    schema: {
      body: CreateUserBodySchema,
      response: { 200: UserSchema, 201: UserSchema, 409: z.object({ error: z.string() }) },
    },
    handler: async (req, reply) => {
      const { name } = req.body as { name: string };

      if (isHostName(name)) {
        const outcome = await claimOrConflict(name);
        if (outcome.kind === "conflict") {
          return reply
            .code(409)
            .send({ error: "host_name_taken" });
        }
        setUserCookie(reply, outcome.userId);
        if (outcome.kind === "created" || outcome.kind === "taken_over") {
          notifyHostChanged(outcome.userId, outcome.userName).catch((err) =>
            req.log.error({ err }, "notifyHostChanged failed")
          );
        }
        return reply.code(201).send({
          id: outcome.userId,
          name: outcome.userName,
          isHost: true,
        });
      }

      const existing = await prisma.user.findUnique({ where: { name } });
      if (existing) {
        setUserCookie(reply, existing.id);
        await prisma.user.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date() },
        });
        return reply.send({
          id: existing.id,
          name: existing.name,
          isHost: existing.isHost,
        });
      }

      const created = await prisma.user.create({
        data: { name, isHost: false, lastSeenAt: new Date() },
      });
      setUserCookie(reply, created.id);
      return reply.code(201).send({
        id: created.id,
        name: created.name,
        isHost: false,
      });
    },
  });

  app.post("/api/users/heartbeat", async (req, reply) => {
    const user = await requireUser(req);
    await heartbeat(user.id);
    return reply.code(204).send();
  });

  app.get("/api/users/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    return reply.send(req.user);
  });
}
