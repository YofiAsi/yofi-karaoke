import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { unsignUserId } from "./signedUserId.js";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface AuthUser {
  id: string;
  name: string;
  isHost: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function loadUserFromCookie(req: FastifyRequest): Promise<AuthUser | null> {
  const uid = unsignUserId(req.cookies?.[env.COOKIE_NAME], env.SESSION_SECRET);
  if (!uid) return null;
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user) return null;
  return { id: user.id, name: user.name, isHost: user.isHost };
}

function shouldUseSecureCookie(req: FastifyRequest): boolean {
  return req.protocol === "https";
}

export function setUserCookie(req: FastifyRequest, reply: FastifyReply, userId: string): void {
  reply.setCookie(env.COOKIE_NAME, userId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(req),
    signed: true,
    maxAge: ONE_YEAR_SECONDS,
  });
}

export async function attachUserHook(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const user = await loadUserFromCookie(req);
  if (user) req.user = user;
}

export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  if (!req.user) {
    const err = new Error("unauthenticated");
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
  return req.user;
}
