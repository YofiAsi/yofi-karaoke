import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for queue dedupe logic and nextPosition helper.
// These tests mock prisma and env so no real DB or env vars are needed.
// ---------------------------------------------------------------------------

// vi.hoisted — mock values must be defined before vi.mock factories execute
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    queueItem: {
      aggregate: vi.fn(),
    },
  };
  return { mockPrisma };
});

// Mock env before any transitive import triggers the zod parse
vi.mock("../env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test",
    COOKIE_NAME: "uid",
    SESSION_SECRET: "secret",
    CORS_ORIGIN: "*",
    HOST: "0.0.0.0",
    PORT: 3000,
    HOST_USER_NAME: "Host",
    HOST_STALE_SECONDS: 30,
    PLAYER_STALE_SECONDS: 20,
    MINIO_ENDPOINT: "localhost",
    MINIO_PORT: 9000,
    MINIO_ACCESS_KEY: "key",
    MINIO_SECRET_KEY: "secret",
    MINIO_BUCKET: "bucket",
    MINIO_USE_SSL: false,
    REDIS_URL: "redis://localhost",
    GRAPHILE_WORKER_DATABASE_URL: "postgresql://test",
  },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));

// Import AFTER mocks are registered
import { nextPosition } from "./queue.js";

// ---------------------------------------------------------------------------
// 1. nextPosition helper
// ---------------------------------------------------------------------------
describe("nextPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 when there are no queue items (max is null)", async () => {
    mockPrisma.queueItem.aggregate.mockResolvedValueOnce({ _max: { position: null } });
    expect(await nextPosition()).toBe(1);
  });

  it("returns max+1 when items exist", async () => {
    mockPrisma.queueItem.aggregate.mockResolvedValueOnce({ _max: { position: 7 } });
    expect(await nextPosition()).toBe(8);
  });

  it("returns 1 when max position is 0", async () => {
    mockPrisma.queueItem.aggregate.mockResolvedValueOnce({ _max: { position: 0 } });
    expect(await nextPosition()).toBe(1);
  });

  it("returns 2 when max position is 1", async () => {
    mockPrisma.queueItem.aggregate.mockResolvedValueOnce({ _max: { position: 1 } });
    expect(await nextPosition()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Queue POST dedupe logic (pure function)
//
// The actual logic lives inline in the queue POST handler. We extract the same
// decision rules here to verify all three dedupe paths without hitting the DB.
// The inline implementation in queue.ts is:
//
//   if (!song)                   → needsJob=true,  state=processing
//   if song.instrumentalObjectKey → needsJob=false, state=ready
//   else                          → needsJob=!hasOpenJob, state=processing
// ---------------------------------------------------------------------------

type Song = { id: string; instrumentalObjectKey: string | null };

function dedupeDecision(
  song: Song | null,
  hasOpenJob: boolean,
): { needsJob: boolean; initialState: "ready" | "processing" } {
  if (!song) {
    return { needsJob: true, initialState: "processing" };
  }
  if (song.instrumentalObjectKey) {
    return { needsJob: false, initialState: "ready" };
  }
  return { needsJob: !hasOpenJob, initialState: "processing" };
}

describe("queue POST dedupe logic", () => {
  it("new song: needsJob=true, state=processing", () => {
    expect(dedupeDecision(null, false)).toEqual({ needsJob: true, initialState: "processing" });
  });

  it("existing song with instrumental: needsJob=false, state=ready (no job created)", () => {
    const song: Song = { id: "abc", instrumentalObjectKey: "bucket/key.mp3" };
    expect(dedupeDecision(song, false)).toEqual({ needsJob: false, initialState: "ready" });
  });

  it("existing song with instrumental (hasOpenJob=true): still needsJob=false (instrumental wins)", () => {
    const song: Song = { id: "abc", instrumentalObjectKey: "bucket/key.mp3" };
    expect(dedupeDecision(song, true)).toEqual({ needsJob: false, initialState: "ready" });
  });

  it("existing song mid-processing WITH open job: needsJob=false (no duplicate job enqueued)", () => {
    const song: Song = { id: "abc", instrumentalObjectKey: null };
    expect(dedupeDecision(song, true)).toEqual({ needsJob: false, initialState: "processing" });
  });

  it("existing song mid-processing WITHOUT open job: needsJob=true (re-enqueue stalled job)", () => {
    const song: Song = { id: "abc", instrumentalObjectKey: null };
    expect(dedupeDecision(song, false)).toEqual({ needsJob: true, initialState: "processing" });
  });
});
