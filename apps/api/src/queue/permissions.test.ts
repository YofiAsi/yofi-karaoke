import { describe, expect, it, vi } from "vitest";
import type { QueueState } from "@prisma/client";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../auth/userCookie.js", () => ({ requireUser: vi.fn() }));
vi.mock("../playback/transitions.js", () => ({ lockPlaybackState: vi.fn() }));

import { moveDenial, removalDenial, retryDenial, type Actor } from "./permissions.js";
import { planSwap } from "./management.js";

const REQUESTER: Actor = { userId: "requester", isHost: false };
const STRANGER: Actor = { userId: "stranger", isHost: false };
const HOST: Actor = { userId: "host", isHost: true };

function owned(state: QueueState, id = "item") {
  return { id, requestedByUserId: REQUESTER.userId, state };
}

function codeOf(denial: Error | null): string | null {
  return denial?.message ?? null;
}

describe("removalDenial", () => {
  it("lets the requester and the host remove an upcoming item", () => {
    expect(removalDenial(REQUESTER, owned("queued"), "other")).toBeNull();
    expect(removalDenial(HOST, owned("ready"), "other")).toBeNull();
    expect(removalDenial(REQUESTER, owned("failed"), null)).toBeNull();
  });

  it("forbids other guests", () => {
    expect(codeOf(removalDenial(STRANGER, owned("queued"), null))).toBe("forbidden");
  });

  it("refuses to remove the playing item, even for the host", () => {
    expect(codeOf(removalDenial(HOST, owned("ready"), "item"))).toBe("is_current");
  });

  it("refuses items that already left the queue", () => {
    expect(codeOf(removalDenial(HOST, owned("played"), null))).toBe("not_removable");
    expect(codeOf(removalDenial(REQUESTER, owned("skipped"), null))).toBe("not_removable");
  });
});

describe("retryDenial", () => {
  it("lets the requester or the host retry a failed item", () => {
    expect(retryDenial(REQUESTER, owned("failed"))).toBeNull();
    expect(retryDenial(HOST, owned("failed"))).toBeNull();
  });

  it("forbids other guests and items that did not fail", () => {
    expect(codeOf(retryDenial(STRANGER, owned("failed")))).toBe("forbidden");
    expect(codeOf(retryDenial(REQUESTER, owned("ready")))).toBe("not_failed");
  });
});

describe("moveDenial", () => {
  it("allows only the host", () => {
    expect(moveDenial(HOST)).toBeNull();
    expect(codeOf(moveDenial(REQUESTER))).toBe("forbidden");
  });
});

describe("planSwap", () => {
  const upcoming = [
    { id: "a", position: 2 },
    { id: "b", position: 5 },
    { id: "c", position: 9 },
  ];

  it("swaps with the neighbor in the requested direction", () => {
    expect(planSwap(upcoming, "b", "up")).toEqual({ kind: "swap", moving: upcoming[1], neighbor: upcoming[0] });
    expect(planSwap(upcoming, "b", "down")).toEqual({ kind: "swap", moving: upcoming[1], neighbor: upcoming[2] });
  });

  it("does nothing at either end", () => {
    expect(planSwap(upcoming, "a", "up")).toEqual({ kind: "edge" });
    expect(planSwap(upcoming, "c", "down")).toEqual({ kind: "edge" });
  });

  it("reports items that are not upcoming", () => {
    expect(planSwap(upcoming, "current", "up")).toEqual({ kind: "missing" });
  });
});
