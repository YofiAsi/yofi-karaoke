import { describe, expect, it, vi } from "vitest";
import type { QueueState } from "@prisma/client";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../auth/userCookie.js", () => ({ requireUser: vi.fn() }));
vi.mock("../playback/transitions.js", () => ({ lockPlaybackState: vi.fn() }));

import { moveDenial, removalDenial, retryDenial, type Actor } from "./permissions.js";
import { planMove } from "./management.js";

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

function applyMove(items: { id: string; position: number }[], updates: { id: string; position: number }[]) {
  const byId = new Map(updates.map((u) => [u.id, u.position]));
  return items
    .map((i) => ({ ...i, position: byId.get(i.id) ?? i.position }))
    .sort((a, b) => a.position - b.position)
    .map((i) => i.id);
}

describe("planMove", () => {
  const upcoming = [
    { id: "a", position: 2 },
    { id: "b", position: 5 },
    { id: "c", position: 9 },
  ];

  it("swaps positions with the neighbor in the requested direction", () => {
    expect(planMove(upcoming, "b", "up")).toEqual({
      kind: "reorder",
      updates: [
        { id: "b", position: 2 },
        { id: "a", position: 5 },
      ],
    });
    const down = planMove(upcoming, "b", "down");
    expect(down.kind === "reorder" && applyMove(upcoming, down.updates)).toEqual(["a", "c", "b"]);
  });

  it("really reorders items that share a position", () => {
    const tied = [
      { id: "a", position: 4 },
      { id: "b", position: 4 },
      { id: "c", position: 4 },
    ];
    const plan = planMove(tied, "c", "up");
    expect(plan.kind).toBe("reorder");
    if (plan.kind !== "reorder") return;
    expect(plan.updates.length).toBeGreaterThan(0);
    expect(applyMove(tied, plan.updates)).toEqual(["a", "c", "b"]);
  });

  it("does nothing at either end", () => {
    expect(planMove(upcoming, "a", "up")).toEqual({ kind: "edge" });
    expect(planMove(upcoming, "c", "down")).toEqual({ kind: "edge" });
  });

  it("reports items that are not upcoming", () => {
    expect(planMove(upcoming, "current", "up")).toEqual({ kind: "missing" });
  });
});
