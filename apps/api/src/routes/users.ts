import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateUserBodySchema,
  UserSchema,
  PgNotifyChannels,
  type CreateUserBody,
} from "@karaoke/shared";
import { prisma } from "../db.js";
import { setUserCookie, requireUser } from "../auth/userCookie.js";
import { nameMatches, OLDEST_FIRST } from "../auth/userName.js";
import { claimOrConflict, heartbeat, isHostName } from "../host/hostService.js";
import { authorizeHostPin } from "../host/hostPin.js";

const ErrorSchema = z.object({ error: z.string() });

async function notifyHostChanged(hostUserId: string, hostUserName: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    PgNotifyChannels.hostChanged,
    JSON.stringify({ hostUserId, hostUserName }),
  );
}

async function claimHost(req: FastifyRequest, reply: FastifyReply, pin: string | undefined) {
  const rejection = authorizeHostPin(req.ip, pin);
  if (rejection) return reply.code(rejection.status).send({ error: rejection.error });

  const outcome = await claimOrConflict();
  if (outcome.kind === "conflict") {
    return reply.code(409).send({ error: "host_name_taken" });
  }
  setUserCookie(req, reply, outcome.userId);
  if (outcome.kind === "created" || outcome.kind === "taken_over") {
    notifyHostChanged(outcome.userId, outcome.userName).catch((err) =>
      req.log.error({ err }, "notifyHostChanged failed"),
    );
  }
  return reply.code(201).send({ id: outcome.userId, name: outcome.userName, isHost: true });
}

async function joinAsGuest(req: FastifyRequest, reply: FastifyReply, name: string) {
  const existing = await prisma.user.findFirst({ where: nameMatches(name), orderBy: OLDEST_FIRST });
  if (existing?.isHost) {
    return reply.code(409).send({ error: "name_taken" });
  }
  if (existing) {
    setUserCookie(req, reply, existing.id);
    await prisma.user.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
    return reply.send({ id: existing.id, name: existing.name, isHost: false });
  }

  const created = await prisma.user.create({
    data: { name, isHost: false, lastSeenAt: new Date() },
  });
  setUserCookie(req, reply, created.id);
  return reply.code(201).send({ id: created.id, name: created.name, isHost: false });
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/users", {
    schema: {
      body: CreateUserBodySchema,
      response: {
        200: UserSchema,
        201: UserSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        429: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const { name, pin } = req.body as CreateUserBody;
      if (isHostName(name)) return claimHost(req, reply, pin);
      return joinAsGuest(req, reply, name);
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
