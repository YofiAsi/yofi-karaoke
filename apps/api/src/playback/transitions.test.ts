// advance, rewind and play against an in memory PlaybackState and QueueItem table.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type OrderBy = Record<string, "asc" | "desc"> | Record<string, "asc" | "desc">[];

const { db, resetDb } = vi.hoisted(() => {
  const tables = { playback: {} as Row, items: [] as Row[] };

  function matches(row: Row, where: Where = {}): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === "object" && "not" in expected) {
        return row[key] !== (expected as { not: unknown }).not;
      }
      if (expected && typeof expected === "object" && "in" in expected) {
        return (expected as { in: unknown[] }).in.includes(row[key]);
      }
      return row[key] === expected;
    });
  }

  function compareBy(orderBy: OrderBy) {
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
    return (a: Row, b: Row) => {
      for (const [key, dir] of keys) {
        const av = a[key] as number | Date | null;
        const bv = b[key] as number | Date | null;
        if (av === bv) continue;
        const delta = Number(av ?? 0) - Number(bv ?? 0);
        if (delta !== 0) return dir === "asc" ? delta : -delta;
      }
      return 0;
    };
  }

  function findItems(where?: Where, orderBy?: OrderBy): Row[] {
    const found = tables.items.filter((r) => matches(r, where));
    return orderBy ? found.sort(compareBy(orderBy)) : found;
  }

  const client = {
    playbackState: {
      findUniqueOrThrow: async () => ({ ...tables.playback }),
      update: async ({ data }: { data: Row }) => Object.assign(tables.playback, data),
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        if (!matches(tables.playback, where)) return { count: 0 };
        Object.assign(tables.playback, data);
        return { count: 1 };
      },
    },
    queueItem: {
      findFirst: async ({ where, orderBy }: { where?: Where; orderBy?: OrderBy }) =>
        findItems(where, orderBy)[0] ?? null,
      findUnique: async ({ where }: { where: Where }) => findItems(where)[0] ?? null,
      update: async ({ where, data }: { where: Where; data: Row }) =>
        Object.assign(findItems(where)[0]!, data),
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const found = findItems(where);
        found.forEach((r) => Object.assign(r, data));
        return { count: found.length };
      },
    },
  };

  let rowLock: Promise<unknown> = Promise.resolve();
  const db = {
    ...client,
    $transaction: <T>(work: (tx: typeof client) => Promise<T>): Promise<T> => {
      const run = rowLock.then(() => work(client));
      rowLock = run.catch(() => undefined);
      return run;
    },
    tables,
  };

  function resetDb(currentQueueItemId: string | null, items: Row[]): void {
    tables.playback = { id: 1, currentQueueItemId, positionSeconds: 42, isPlaying: true };
    tables.items = items.map((i, index) => ({ createdAt: new Date(index), playedAt: null, ...i }));
  }

  return { db, resetDb };
});

vi.mock("../db.js", () => ({ prisma: db }));

import { advance, play, rewind } from "./transitions.js";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

function stateOf(id: string): unknown {
  return db.tables.items.find((i) => i.id === id)?.state;
}

describe("advance", () => {
  beforeEach(() => {
    resetDb(A, [
      { id: A, state: "ready", position: 1 },
      { id: B, state: "ready", position: 2 },
      { id: C, state: "ready", position: 3 },
    ]);
  });

  it("marks the expected item played and promotes the next ready item by position", async () => {
    const result = await advance(A);
    expect(result).toEqual({ changed: true, currentQueueItemId: B });
    expect(stateOf(A)).toBe("played");
    expect(db.tables.playback).toMatchObject({ currentQueueItemId: B, positionSeconds: 0, isPlaying: true });
  });

  it("advances once when two callers report the same item ended", async () => {
    const [first, second] = await Promise.all([advance(A), advance(A)]);
    expect([first.changed, second.changed].sort()).toEqual([false, true]);
    expect(db.tables.playback.currentQueueItemId).toBe(B);
    expect(stateOf(B)).toBe("ready");
    expect(stateOf(C)).toBe("ready");
  });

  it("is a no op for a stale expected id", async () => {
    const result = await advance(C);
    expect(result).toEqual({ changed: false, currentQueueItemId: A });
    expect(stateOf(A)).toBe("ready");
    expect(stateOf(C)).toBe("ready");
    expect(db.tables.playback.positionSeconds).toBe(42);
  });

  it("promotes by position, not by insertion order", async () => {
    resetDb(A, [
      { id: A, state: "ready", position: 1 },
      { id: C, state: "ready", position: 5 },
      { id: B, state: "ready", position: 3 },
    ]);
    expect((await advance(A)).currentQueueItemId).toBe(B);
  });

  it("skips items that are not ready yet", async () => {
    resetDb(A, [
      { id: A, state: "ready", position: 1 },
      { id: B, state: "processing", position: 2 },
      { id: C, state: "ready", position: 3 },
    ]);
    expect((await advance(A)).currentQueueItemId).toBe(C);
  });

  it("stops playback when nothing is ready", async () => {
    resetDb(A, [{ id: A, state: "ready", position: 1 }]);
    expect(await advance(A)).toEqual({ changed: true, currentQueueItemId: null });
    expect(db.tables.playback).toMatchObject({ currentQueueItemId: null, isPlaying: false });
  });
});

describe("play", () => {
  it("promotes the first ready item when nothing is current", async () => {
    resetDb(null, [
      { id: B, state: "ready", position: 2 },
      { id: A, state: "processing", position: 1 },
    ]);
    db.tables.playback.isPlaying = false;
    expect(await play()).toEqual({ changed: true, currentQueueItemId: B });
    expect(db.tables.playback.isPlaying).toBe(true);
  });

  it("keeps the current song when an earlier item becomes ready", async () => {
    resetDb(B, [
      { id: A, state: "ready", position: 1 },
      { id: B, state: "ready", position: 2 },
    ]);
    db.tables.playback.isPlaying = false;
    expect(await play()).toEqual({ changed: true, currentQueueItemId: B });
    expect(db.tables.playback.positionSeconds).toBe(42);
  });

  it("reports no change when the queue has nothing ready", async () => {
    resetDb(null, [{ id: A, state: "processing", position: 1 }]);
    db.tables.playback.isPlaying = false;
    expect(await play()).toEqual({ changed: false, currentQueueItemId: null });
    expect(db.tables.playback.isPlaying).toBe(false);
  });
});

describe("rewind", () => {
  it("restores the last played item and keeps the current one ready", async () => {
    resetDb(B, [
      { id: A, state: "played", position: 1, playedAt: new Date(1000) },
      { id: C, state: "played", position: 0, playedAt: new Date(10) },
      { id: B, state: "ready", position: 2 },
    ]);
    expect(await rewind(B)).toEqual({ changed: true, currentQueueItemId: A });
    expect(stateOf(A)).toBe("ready");
    expect(stateOf(B)).toBe("ready");
    expect((await advance(A)).currentQueueItemId).toBe(B);
  });

  it("is a no op for a stale expected id", async () => {
    resetDb(B, [{ id: A, state: "played", position: 1, playedAt: new Date(1000) }]);
    expect(await rewind(C)).toEqual({ changed: false, currentQueueItemId: B });
    expect(stateOf(A)).toBe("played");
  });
});
