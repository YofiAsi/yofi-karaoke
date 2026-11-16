import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Song } from "@prisma/client";

const { mockPrisma, enqueueProcessSong, ytdlpInfo } = vi.hoisted(() => ({
  mockPrisma: {
    song: { findUnique: vi.fn(), upsert: vi.fn(), findUniqueOrThrow: vi.fn() },
    queueItem: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    processingJob: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  enqueueProcessSong: vi.fn(),
  ytdlpInfo: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("../jobs/enqueueProcessSong.js", () => ({ enqueueProcessSong }));
vi.mock("../ytdlp.js", () => ({ ytdlpInfo, pickTrackMetadata: () => ({}) }));

import { findOrCreateSong, nextPosition, queueSong } from "./addition.js";

const USER_ID = "00000000-0000-4000-8000-0000000000u1";
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

function givenQueue({ failed = null as unknown, active = null as unknown, openJob = null as unknown }) {
  mockPrisma.queueItem.findFirst.mockImplementation(async ({ where }: { where: { state: unknown } }) =>
    where.state === "failed" ? failed : active,
  );
  mockPrisma.processingJob.findFirst.mockResolvedValue(openJob);
  mockPrisma.queueItem.aggregate.mockResolvedValue({ _max: { position: 7 } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queueSong after a failure", () => {
  it("returns the failed item to queued and enqueues processing again", async () => {
    givenQueue({ failed: FAILED_ITEM });
    mockPrisma.queueItem.updateMany.mockResolvedValue({ count: 1 });

    const item = await queueSong(song(), USER_ID);

    expect(item).toMatchObject({ id: FAILED_ITEM.id, state: "queued", position: 4 });
    expect(mockPrisma.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: FAILED_ITEM.id, state: "failed" },
      data: { state: "queued" },
    });
    expect(mockPrisma.queueItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.processingJob.create).toHaveBeenCalled();
    expect(enqueueProcessSong).toHaveBeenCalledWith("song-1");
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
