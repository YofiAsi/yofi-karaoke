import { describe, expect, it, vi } from "vitest";

const { playback } = vi.hoisted(() => ({
  playback: { id: 1, currentQueueItemId: "item" as string | null, vocalsGain: 0 },
}));

vi.mock("../db.js", () => ({
  prisma: {
    playbackState: {
      updateMany: async ({ where, data }: { where: typeof playback; data: { vocalsGain: number } }) => {
        if (where.currentQueueItemId !== playback.currentQueueItemId) return { count: 0 };
        Object.assign(playback, data);
        return { count: 1 };
      },
    },
  },
}));
vi.mock("../auth/userCookie.js", () => ({ requireUser: vi.fn() }));

import { storeVocalsGain, vocalsGainDenial, type CurrentForVocals } from "./vocals.js";
import type { Actor } from "../queue/permissions.js";

const REQUESTER: Actor = { userId: "requester", isHost: false };
const STRANGER: Actor = { userId: "stranger", isHost: false };
const HOST: Actor = { userId: "host", isHost: true };
const CURRENT: CurrentForVocals = { id: "item", requestedByUserId: "requester", hasVocals: true };

function codeOf(denial: Error | null): string | null {
  return denial?.message ?? null;
}

describe("vocalsGainDenial", () => {
  it("lets the current host and the requester of the current song change the gain", () => {
    expect(vocalsGainDenial(HOST, CURRENT, "item")).toBeNull();
    expect(vocalsGainDenial(REQUESTER, CURRENT, "item")).toBeNull();
  });

  it("forbids other guests", () => {
    expect(codeOf(vocalsGainDenial(STRANGER, CURRENT, "item"))).toBe("forbidden");
  });

  it("rejects a stale or missing current item", () => {
    expect(codeOf(vocalsGainDenial(HOST, CURRENT, "previous"))).toBe("not_current");
    expect(codeOf(vocalsGainDenial(REQUESTER, null, "item"))).toBe("not_current");
  });

  it("rejects songs without a vocals stem", () => {
    expect(codeOf(vocalsGainDenial(HOST, { ...CURRENT, hasVocals: false }, "item"))).toBe("no_vocals");
  });
});

describe("storeVocalsGain", () => {
  it("stores the gain while the item is current", async () => {
    expect(await storeVocalsGain("item", 0.4)).toBe(true);
    expect(playback.vocalsGain).toBe(0.4);
  });

  it("ignores a write for an item that stopped being current", async () => {
    playback.currentQueueItemId = "next";
    playback.vocalsGain = 0;
    expect(await storeVocalsGain("item", 0.8)).toBe(false);
    expect(playback.vocalsGain).toBe(0);
  });
});
