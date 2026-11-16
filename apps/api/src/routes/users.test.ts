import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

const SECRET = vi.hoisted(() => "test-session-secret-at-least-32-chars!");
const HOST_ID = "11111111-1111-4111-8111-111111111111";
const GUEST_ID = "22222222-2222-4222-8222-222222222222";

const { mockPrisma, mockClaim } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  },
  mockClaim: vi.fn(),
}));

vi.mock("../env.js", () => ({
  env: {
    COOKIE_NAME: "karaoke_uid",
    SESSION_SECRET: SECRET,
    NODE_ENV: "development",
    HOST_USER_NAME: "Host",
    HOST_PIN: "2468",
    HOST_STALE_SECONDS: 30,
  },
}));
vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("../host/hostService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/hostService.js")>()),
  claimOrConflict: mockClaim,
}));

import { registerUserRoutes } from "./users.js";
import { hostPinLimiter } from "../host/hostPin.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie, { secret: SECRET });
  await registerUserRoutes(app);
  return app;
}

function postUser(app: FastifyInstance, payload: Record<string, string>) {
  return app.inject({ method: "POST", url: "/api/users", payload });
}

describe("POST /api/users host claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostPinLimiter.reset("127.0.0.1");
    mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
    mockClaim.mockResolvedValue({ kind: "already_host", userId: HOST_ID, userName: "Host" });
  });

  it("returns 403 pin_required and no cookie when the PIN is missing", async () => {
    const res = await postUser(await buildApp(), { name: "Host" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "pin_required" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("returns 403 invalid_pin and no cookie for a wrong PIN, even while the host is active", async () => {
    const res = await postUser(await buildApp(), { name: "host", pin: "0000" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "invalid_pin" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("treats a differently cased host name as the host and requires the PIN", async () => {
    const res = await postUser(await buildApp(), { name: "  hOsT " });
    expect(res.statusCode).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("sets a signed host cookie for the correct PIN", async () => {
    const res = await postUser(await buildApp(), { name: "HOST", pin: "2468" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: HOST_ID, name: "Host", isHost: true });
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(new RegExp(`^karaoke_uid=${HOST_ID}\\.`));
    expect(setCookie).toMatch(/HttpOnly/);
  });

  it("rate limits repeated wrong PINs", async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) await postUser(app, { name: "Host", pin: "0000" });
    const res = await postUser(app, { name: "Host", pin: "2468" });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "too_many_attempts" });
  });
});

describe("POST /api/users guest join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an existing guest matched case insensitively", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: GUEST_ID, name: "Alice", isHost: false });
    mockPrisma.user.update.mockResolvedValue({});

    const res = await postUser(await buildApp(), { name: "alice" });

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { equals: "alice", mode: "insensitive" } } }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: GUEST_ID, name: "Alice", isHost: false });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("refuses to hand out a user flagged as host through the guest path", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: HOST_ID, name: "OldHost", isHost: true });

    const res = await postUser(await buildApp(), { name: "oldhost" });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "name_taken" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("creates a new guest when the name is unused", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: GUEST_ID, name: "Bob", isHost: false });

    const res = await postUser(await buildApp(), { name: "Bob" });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: GUEST_ID, name: "Bob", isHost: false });
  });
});
