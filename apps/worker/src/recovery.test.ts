import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerUtils } from "graphile-worker";

const { mockQuery, mockNotify, mockMarkFailed } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockNotify: vi.fn(),
  mockMarkFailed: vi.fn(),
}));

vi.mock("./env.js", () => ({ env: { DOWNLOAD_TIMEOUT_MS: 120_000, SEPARATE_TIMEOUT_MS: 180_000 } }));
vi.mock("./db.js", () => ({ pool: { query: mockQuery }, notify: mockNotify }));
vi.mock("./queueState.js", () => ({ markSongFailed: mockMarkFailed }));

import { recoverStaleJobs } from "./recovery.js";

const calls: string[] = [];
const forceUnlockWorkers = vi.fn(async () => void calls.push("unlock"));
const utils = { forceUnlockWorkers } as unknown as WorkerUtils;

function answerQueries(staleSongIds: string[], jobs: object[]) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes(`SELECT DISTINCT "songId"`)) return { rows: staleSongIds.map((songId) => ({ songId })) };
    if (sql.includes("graphile_worker.jobs")) return { rows: jobs };
    calls.push("requeue");
    return { rows: [] };
  });
}

describe("recoverStaleJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("only sweeps rows in an active step with a start time", async () => {
    answerQueries([], []);
    await recoverStaleJobs(utils, ["running"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`"startedAt" IS NOT NULL`);
    expect(params[0]).toEqual(["downloading", "separating", "fetching_lyrics"]);
    expect(params[0]).not.toContain("pending");
    expect(params[1]).toBe(645_000);
    expect(params[2]).toEqual(["running"]);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("requeues before unlocking the dead worker, and does not fail the song", async () => {
    answerQueries(["s1"], [{ key: "s1", lockedBy: "dead", attempts: 1, maxAttempts: 3 }]);
    await recoverStaleJobs(utils, []);
    expect(calls).toEqual(["requeue", "unlock"]);
    expect(forceUnlockWorkers).toHaveBeenCalledWith(["dead"]);
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledOnce();
  });

  it("fails the song when its job has no attempts left", async () => {
    answerQueries(["s1"], [{ key: "s1", lockedBy: "dead", attempts: 3, maxAttempts: 3 }]);
    await recoverStaleJobs(utils, []);
    expect(forceUnlockWorkers).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("s1", expect.stringContaining("no retry is left"));
  });
});
