import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — values that must exist before vi.mock factories run
// ---------------------------------------------------------------------------
const { mockTx, mockPrisma } = vi.hoisted(() => {
  const mockTx = {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    playbackState: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  const mockPrisma = {
    $transaction: vi.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
    user: {
      update: vi.fn(),
    },
    playbackState: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  return { mockTx, mockPrisma };
});

// ---------------------------------------------------------------------------
// Mock env so tests never require real environment variables
// ---------------------------------------------------------------------------
vi.mock("../env.js", () => ({
  env: {
    HOST_USER_NAME: "Host",
    HOST_STALE_SECONDS: 30,
    PLAYER_STALE_SECONDS: 20,
  },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import { isHostName, isStale, claimOrConflict, heartbeat } from "./hostService.js";

// ---------------------------------------------------------------------------
// isHostName
// ---------------------------------------------------------------------------
describe("isHostName()", () => {
  it("matches the configured host name exactly", () => {
    expect(isHostName("Host")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHostName("HOST")).toBe(true);
    expect(isHostName("host")).toBe(true);
    expect(isHostName("hOsT")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isHostName("  Host  ")).toBe(true);
    expect(isHostName("\thost\n")).toBe(true);
  });

  it("returns false for a non-matching name", () => {
    expect(isHostName("Alice")).toBe(false);
    expect(isHostName("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStale
// ---------------------------------------------------------------------------
describe("isStale()", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");

  it("returns true when lastHeartbeat is null", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("returns true when lastHeartbeat is undefined", () => {
    expect(isStale(undefined, now)).toBe(true);
  });

  it("returns false for a recent heartbeat well within the window", () => {
    const recent = new Date(now.getTime() - 10_000); // 10 s ago
    expect(isStale(recent, now)).toBe(false);
  });

  it("returns false at exactly HOST_STALE_SECONDS (boundary — not strictly greater)", () => {
    const exactly = new Date(now.getTime() - 30_000); // exactly 30 s
    expect(isStale(exactly, now)).toBe(false);
  });

  it("returns true for a heartbeat just over HOST_STALE_SECONDS", () => {
    const stale = new Date(now.getTime() - 30_001); // 30.001 s ago
    expect(isStale(stale, now)).toBe(true);
  });

  it("returns true for a heartbeat far in the past", () => {
    const ancient = new Date(now.getTime() - 300_000); // 5 min ago
    expect(isStale(ancient, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// claimOrConflict
// ---------------------------------------------------------------------------
describe("claimOrConflict()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the $transaction implementation after clearAllMocks resets it
    mockPrisma.$transaction.mockImplementation(
      (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)
    );
  });

  it("creates a new host when no user with that name exists", async () => {
    mockTx.user.findFirst.mockResolvedValue(null);
    mockTx.playbackState.findUnique.mockResolvedValue(null);
    mockTx.user.create.mockResolvedValue({ id: "u1", name: "Host" });
    mockTx.playbackState.update.mockResolvedValue({});

    const result = await claimOrConflict("Host");

    expect(result).toEqual({ kind: "created", userId: "u1", userName: "Host" });
    expect(mockTx.user.create).toHaveBeenCalledOnce();
    expect(mockTx.playbackState.update).toHaveBeenCalledOnce();
  });

  it("takes over when user exists and heartbeat is stale (no playback row)", async () => {
    mockTx.user.findFirst.mockResolvedValue({ id: "u2", name: "Host" });
    // no playback row → hostLastHeartbeatAt is null → stale
    mockTx.playbackState.findUnique.mockResolvedValue(null);
    mockTx.user.update.mockResolvedValue({});
    mockTx.playbackState.update.mockResolvedValue({});

    const result = await claimOrConflict("Host");

    expect(result).toEqual({ kind: "taken_over", userId: "u2", userName: "Host" });
    expect(mockTx.user.update).toHaveBeenCalledOnce();
  });

  it("takes over when user exists and heartbeat has expired", async () => {
    const staleTime = new Date(Date.now() - 60_000); // 60 s ago — definitely stale
    mockTx.user.findFirst.mockResolvedValue({ id: "u3", name: "Host" });
    mockTx.playbackState.findUnique.mockResolvedValue({
      id: 1,
      hostUserId: "someone-else",
      hostLastHeartbeatAt: staleTime,
    });
    mockTx.user.update.mockResolvedValue({});
    mockTx.playbackState.update.mockResolvedValue({});

    const result = await claimOrConflict("Host");

    expect(result).toEqual({ kind: "taken_over", userId: "u3", userName: "Host" });
  });

  it("returns conflict when user exists, heartbeat is fresh, and a different user is host", async () => {
    const freshTime = new Date(Date.now() - 5_000); // 5 s ago — fresh
    mockTx.user.findFirst.mockResolvedValue({ id: "u4", name: "Host" });
    mockTx.playbackState.findUnique.mockResolvedValue({
      id: 1,
      hostUserId: "other-user-id", // different from u4
      hostLastHeartbeatAt: freshTime,
    });

    const result = await claimOrConflict("Host");

    expect(result).toEqual({ kind: "conflict" });
    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.user.create).not.toHaveBeenCalled();
  });

  it("returns already_host when user exists and is already the current host with a fresh heartbeat", async () => {
    const freshTime = new Date(Date.now() - 5_000); // 5 s ago
    mockTx.user.findFirst.mockResolvedValue({ id: "u5", name: "Host" });
    mockTx.playbackState.findUnique.mockResolvedValue({
      id: 1,
      hostUserId: "u5", // same as existing user
      hostLastHeartbeatAt: freshTime,
    });

    const result = await claimOrConflict("Host");

    expect(result).toEqual({ kind: "already_host", userId: "u5", userName: "Host" });
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------
describe("heartbeat()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates user.lastSeenAt", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.playbackState.findUnique.mockResolvedValue(null);

    await heartbeat("u1");

    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } })
    );
  });

  it("updates playback hostLastHeartbeatAt when the user is the current host", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.playbackState.findUnique.mockResolvedValue({
      id: 1,
      hostUserId: "u1",
      hostLastHeartbeatAt: new Date(),
    });
    mockPrisma.playbackState.update.mockResolvedValue({});

    await heartbeat("u1");

    expect(mockPrisma.playbackState.update).toHaveBeenCalledOnce();
    expect(mockPrisma.playbackState.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } })
    );
  });

  it("does NOT update playback when the user is not the current host", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.playbackState.findUnique.mockResolvedValue({
      id: 1,
      hostUserId: "other-user",
      hostLastHeartbeatAt: new Date(),
    });

    await heartbeat("u1");

    expect(mockPrisma.playbackState.update).not.toHaveBeenCalled();
  });
});
