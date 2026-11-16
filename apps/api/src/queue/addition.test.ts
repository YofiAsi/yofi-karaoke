import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Song } from "@prisma/client";

const { mockPrisma, enqueueProcessSong, ytdlpInfo, events } = vi.hoisted(() => {
  const events: string[] = [];
  const mockPrisma = {
    song: { findUnique: vi.fn(), upsert: vi.fn(), findUniqueOrThrow: vi.fn() },
    user: { findUnique: vi.fn() },
    playbackState: { findUnique: vi.fn() },
    queueItem: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    processingJob: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(async () => {
      events.push("lock");
      return [{ currentQueueItemId: null }];
    }),
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? arg(mockPrisma) : arg,
    ),
  };
  return { mockPrisma, enqueueProcessSong: vi.fn(), ytdlpInfo: vi.fn(), events };
});

vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("../env.js", () => ({ env: { MAX_ACTIVE_ITEMS_PER_USER: 5 } }));
vi.mock("../jobs/enqueueProcessSong.js", () => ({ enqueueProcessSong }));
vi.mock("../ytdlp.js", () => ({ ytdlpInfo, pickTrackMetadata: () => ({}) }));

import { exceedsQueueLimit, findOrCreateSong, nextPosition, queueSong, reviveFailedItem } from "./addition.js";

const USER_ID = "00000000-0000-4000-8000-0000000000u1";
const ALICE_ID = "00000000-0000-4000-8000-0000000000a1";
const FAILED_ITEM = {
  id: "00000000-0000-4000-8000-00000000000f",
  songId: "song-1",
  requestedByUserId: USER_ID,
  position: 4,
  state: "failed",
  createdAt: new Date(0),
  playedAt: null,
};

function song(instrumentalObjectKey: string | null = null): Song {
  return { id: "song-1", youtubeVideoId: "dQw4w9WgXcQ", instrumentalObjectKey } as Song;
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5" });
}

function givenQueue({
  failed = null as unknown,
  active = null as unknown,
  openJob = null as unknown,
  userActiveCount = 0,
  isHost = false,
  hostUserId = undefined as string | undefined,
}) {
  mockPrisma.user.findUnique.mockResolvedValue({ isHost });
  mockPrisma.playbackState.findUnique.mockResolvedValue({ hostUserId: hostUserId ?? (isHost ? USER_ID : null) });
  mockPrisma.queueItem.count.mockResolvedValue(userActiveCount);
  mockPrisma.queueItem.findFirst.mockImplementation(async ({ where }: { where: { state: unknown } }) =>
    where.state === "failed" ? failed : active,
  );
  mockPrisma.processingJob.findFirst.mockResolvedValue(openJob);
  mockPrisma.queueItem.aggregate.mockImplementation(async () => {
    events.push("position");
    return { _max: { position: 7 } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
});

describe("queueSong after a failure", () => {
  it("hands the failed item to the new requester at the end of the queue and enqueues again", async () => {
    givenQueue({ failed: { ...FAILED_ITEM, requestedByUserId: ALICE_ID } });
    mockPrisma.queueItem.updateMany.mockResolvedValue({ count: 1 });

    const item = await queueSong(song(), USER_ID);

    expect(item).toMatchObject({ id: FAILED_ITEM.id, state: "queued", position: 8, requestedByUserId: USER_ID });
    expect(mockPrisma.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: FAILED_ITEM.id, state: "failed" },
      data: { state: "queued", requestedByUserId: USER_ID, position: 8 },
    });
    expect(events).toEqual(["lock", "position"]);
    expect(mockPrisma.queueItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.processingJob.create).toHaveBeenCalled();
    expect(enqueueProcessSong).toHaveBeenCalledWith("song-1");
  });

  it("keeps requester and position when the failed item is retried", async () => {
    givenQueue({});
    mockPrisma.queueItem.updateMany.mockResolvedValue({ count: 1 });

    const item = await reviveFailedItem({ ...FAILED_ITEM, requestedByUserId: ALICE_ID } as never, song());

    expect(item).toMatchObject({ state: "queued", position: 4, requestedByUserId: ALICE_ID });
    expect(mockPrisma.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: FAILED_ITEM.id, state: "failed" },
      data: { state: "queued" },
    });
  });

  it("revives straight to ready when the song was processed meanwhile", async () => {
    givenQueue({ failed: FAILED_ITEM });
    mockPrisma.queueItem.updateMany.mockResolvedValue({ count: 1 });

    const item = await queueSong(song("instrumental.mp3"), USER_ID);

    expect(item.state).toBe("ready");
    expect(enqueueProcessSong).not.toHaveBeenCalled();
  });

  it("rejects when another caller revived the item first", async () => {
    givenQueue({ failed: FAILED_ITEM });
    mockPrisma.queueItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(queueSong(song(), USER_ID)).rejects.toMatchObject({ statusCode: 409, message: "already_queued" });
    expect(enqueueProcessSong).not.toHaveBeenCalled();
  });
});

describe("queueSong for a new item", () => {
  it("creates a processing item at the end and enqueues once", async () => {
    givenQueue({});
    mockPrisma.queueItem.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new", ...data }));

    const item = await queueSong(song(), USER_ID);

    expect(item).toMatchObject({ state: "processing", position: 8 });
    expect(events).toEqual(["lock", "position"]);
    expect(enqueueProcessSong).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue while a processing job is still open", async () => {
    givenQueue({ openJob: { id: "job" } });
    mockPrisma.queueItem.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new", ...data }));

    await queueSong(song(), USER_ID);

    expect(enqueueProcessSong).not.toHaveBeenCalled();
  });

  it("rejects a song that is already active", async () => {
    givenQueue({ active: { id: "active" } });
    await expect(queueSong(song(), USER_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("maps a unique violation on the active queue index to already_queued", async () => {
    givenQueue({});
    mockPrisma.queueItem.create.mockRejectedValue(uniqueViolation());

    await expect(queueSong(song(), USER_ID)).rejects.toMatchObject({ statusCode: 409, message: "already_queued" });
    expect(enqueueProcessSong).not.toHaveBeenCalled();
  });
});

describe("queueSong per user limit", () => {
  it("rejects a guest who already has the maximum active items", async () => {
    givenQueue({ userActiveCount: 5 });

    await expect(queueSong(song(), USER_ID)).rejects.toMatchObject({ statusCode: 409, message: "queue_limit" });
    expect(mockPrisma.queueItem.count).toHaveBeenCalledWith({
      where: { requestedByUserId: USER_ID, state: { in: ["queued", "processing", "ready"] } },
    });
    expect(mockPrisma.queueItem.create).not.toHaveBeenCalled();
    expect(enqueueProcessSong).not.toHaveBeenCalled();
  });

  it("lets the host queue beyond the limit", async () => {
    givenQueue({ userActiveCount: 9, isHost: true });
    mockPrisma.queueItem.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new", ...data }));

    await expect(queueSong(song(), USER_ID)).resolves.toMatchObject({ id: "new" });
  });

  it("applies the limit when a failed item is handed to a new requester", async () => {
    givenQueue({ failed: FAILED_ITEM, userActiveCount: 5 });

    await expect(queueSong(song(), USER_ID)).rejects.toMatchObject({ message: "queue_limit" });
    expect(mockPrisma.queueItem.updateMany).not.toHaveBeenCalled();
  });

  it("applies the limit to the original requester when a failed item is retried", async () => {
    givenQueue({ userActiveCount: 5 });

    await expect(reviveFailedItem(FAILED_ITEM as never, song())).rejects.toMatchObject({ message: "queue_limit" });
    expect(mockPrisma.queueItem.count).toHaveBeenCalledWith({
      where: { requestedByUserId: FAILED_ITEM.requestedByUserId, state: { in: ["queued", "processing", "ready"] } },
    });
    expect(mockPrisma.queueItem.updateMany).not.toHaveBeenCalled();
  });

  it("allows a retry while the original requester is under the limit", async () => {
    givenQueue({ userActiveCount: 4 });
    mockPrisma.queueItem.updateMany.mockResolvedValue({ count: 1 });

    await expect(reviveFailedItem(FAILED_ITEM as never, song())).resolves.toMatchObject({ state: "queued" });
  });

  it("does not exempt a stored host flag that is not the current host", async () => {
    givenQueue({ userActiveCount: 5, isHost: true, hostUserId: ALICE_ID });

    await expect(queueSong(song(), USER_ID)).rejects.toMatchObject({ message: "queue_limit" });
  });

  it("compares the active count against the limit", () => {
    expect(exceedsQueueLimit(4, 5, false)).toBe(false);
    expect(exceedsQueueLimit(5, 5, false)).toBe(true);
    expect(exceedsQueueLimit(50, 5, true)).toBe(false);
  });
});

describe("findOrCreateSong", () => {
  it("upserts a new song and rereads it when a concurrent insert wins", async () => {
    mockPrisma.song.findUnique.mockResolvedValue(null);
    ytdlpInfo.mockResolvedValue({ title: "T", duration: 100 });
    mockPrisma.song.upsert.mockRejectedValue(uniqueViolation());
    mockPrisma.song.findUniqueOrThrow.mockResolvedValue(song());

    expect(await findOrCreateSong("dQw4w9WgXcQ")).toEqual(song());
    expect(mockPrisma.song.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { youtubeVideoId: "dQw4w9WgXcQ" }, update: {} }),
    );
  });

  it("returns 422 for an unavailable video", async () => {
    mockPrisma.song.findUnique.mockResolvedValue(null);
    ytdlpInfo.mockRejectedValue(new Error("ERROR: Video unavailable"));

    await expect(findOrCreateSong("dQw4w9WgXcQ")).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("nextPosition", () => {
  it("returns 1 for an empty queue and max plus one otherwise", async () => {
    mockPrisma.queueItem.aggregate.mockResolvedValueOnce({ _max: { position: null } });
    expect(await nextPosition()).toBe(1);
    mockPrisma.queueItem.aggregate.mockResolvedValueOnce({ _max: { position: 7 } });
    expect(await nextPosition()).toBe(8);
  });
});
