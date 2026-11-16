import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

const SECRET = vi.hoisted(() => "test-session-secret-at-least-32-chars!");
const USER_ID = "8b1a9953-c461-4296-8c4c-1f0e9b3a6c2d";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("../env.js", () => ({
  env: { COOKIE_NAME: "karaoke_uid", SESSION_SECRET: SECRET, NODE_ENV: "production" },
}));
vi.mock("../db.js", () => ({ prisma: mockPrisma }));

import { setUserCookie, attachUserHook } from "./userCookie.js";
import { signUserId, unsignUserId, readUserIdFromCookieHeader } from "./signedUserId.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  app.addHook("preHandler", attachUserHook);
  app.post("/login", async (req, reply) => {
    setUserCookie(req, reply, USER_ID);
    return reply.send({ ok: true });
  });
  app.get("/me", async (req, reply) => reply.send({ user: req.user ?? null }));
  return app;
}

function extractCookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

describe("signed user id", () => {
  it("round trips a signed value", () => {
    expect(unsignUserId(signUserId(USER_ID, SECRET), SECRET)).toBe(USER_ID);
  });

  it("rejects a raw unsigned legacy value", () => {
    expect(unsignUserId(USER_ID, SECRET)).toBeNull();
  });

  it("rejects a value signed with another secret", () => {
    const forged = signUserId(USER_ID, "attacker-secret-attacker-secret-xx");
    expect(unsignUserId(forged, SECRET)).toBeNull();
  });

  it("rejects a valid signature attached to a different user id", () => {
    const signature = signUserId(USER_ID, SECRET).split(".").pop();
    const tampered = `00000000-0000-4000-8000-000000000000.${signature}`;
    expect(unsignUserId(tampered, SECRET)).toBeNull();
  });

  it("reads the signed id from a raw cookie header as sent in a socket handshake", () => {
    const header = `other=1; karaoke_uid=${encodeURIComponent(signUserId(USER_ID, SECRET))}`;
    expect(readUserIdFromCookieHeader(header, "karaoke_uid", SECRET)).toBe(USER_ID);
    expect(readUserIdFromCookieHeader(`karaoke_uid=${USER_ID}`, "karaoke_uid", SECRET)).toBeNull();
    expect(readUserIdFromCookieHeader(undefined, "karaoke_uid", SECRET)).toBeNull();
  });
});

describe("user cookie over HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER_ID, name: "Alice", isHost: false });
  });

  it("sets a signed, httpOnly, lax cookie that authenticates the next request", async () => {
    const app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/login" });
    const setCookie = String(login.headers["set-cookie"]);

    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
    expect(setCookie).not.toContain(`karaoke_uid=${USER_ID};`);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: extractCookiePair(setCookie) },
    });
    expect(me.json().user).toEqual({ id: USER_ID, name: "Alice", isHost: false });
  });

  it("marks the cookie secure for HTTPS requests behind a proxy", async () => {
    const app = Fastify({ trustProxy: true });
    await app.register(cookie, { secret: SECRET });
    app.post("/login", async (req, reply) => {
      setUserCookie(req, reply, USER_ID);
      return reply.send({ ok: true });
    });
    const login = await app.inject({
      method: "POST",
      url: "/login",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(String(login.headers["set-cookie"])).toMatch(/Secure/);
  });

  it("leaves Secure off for plain HTTP in production so LAN use keeps working", async () => {
    const app = Fastify({ trustProxy: true });
    await app.register(cookie, { secret: SECRET });
    app.post("/login", async (req, reply) => {
      setUserCookie(req, reply, USER_ID);
      return reply.send({ ok: true });
    });
    const login = await app.inject({
      method: "POST",
      url: "/login",
      headers: { "x-forwarded-proto": "http" },
    });
    expect(String(login.headers["set-cookie"])).not.toMatch(/Secure/);
  });

  it("ignores a forged unsigned cookie holding a known user id", async () => {
    const app = await buildApp();
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: `karaoke_uid=${USER_ID}` },
    });
    expect(me.json().user).toBeNull();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
