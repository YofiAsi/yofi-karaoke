import { describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({ env: {} }));

import { planRecovery, staleAfterMs } from "./recoveryPlan.js";

describe("staleAfterMs", () => {
  it("sums download, separation and lyrics budgets plus a five minute margin", () => {
    expect(staleAfterMs({ DOWNLOAD_TIMEOUT_MS: 120_000, SEPARATE_TIMEOUT_MS: 180_000 })).toBe(
      120_000 + 180_000 + 45_000 + 300_000,
    );
  });
});

describe("planRecovery", () => {
  const job = (key: string, lockedBy: string | null, attempts = 1, maxAttempts = 3) => ({ key, lockedBy, attempts, maxAttempts });

  it("requeues a song whose job is locked by a dead worker and unlocks that worker", () => {
    expect(planRecovery(["s1"], [job("s1", "worker-dead")])).toEqual({
      unlockWorkerIds: ["worker-dead"],
      requeueSongIds: ["s1"],
      failSongIds: [],
    });
  });

  it("requeues without unlocking when the job is already unlocked", () => {
    expect(planRecovery(["s1"], [job("s1", null)])).toEqual({
      unlockWorkerIds: [],
      requeueSongIds: ["s1"],
      failSongIds: [],
    });
  });

  it("fails a song when its job used every attempt", () => {
    expect(planRecovery(["s1"], [job("s1", "worker-dead", 3, 3)])).toEqual({
      unlockWorkerIds: [],
      requeueSongIds: [],
      failSongIds: ["s1"],
    });
  });

  it("fails a song with no graphile job left", () => {
    expect(planRecovery(["s1"], [])).toEqual({ unlockWorkerIds: [], requeueSongIds: [], failSongIds: ["s1"] });
  });

  it("unlocks each dead worker once", () => {
    const plan = planRecovery(["s1", "s2"], [job("s1", "w"), job("s2", "w")]);
    expect(plan.unlockWorkerIds).toEqual(["w"]);
    expect(plan.requeueSongIds).toEqual(["s1", "s2"]);
  });
});
