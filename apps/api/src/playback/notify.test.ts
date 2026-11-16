// notifyPlaybackState reads the row under a lock and notifies inside the same transaction.
import { describe, expect, it, vi } from "vitest";

const { calls, row } = vi.hoisted(() => ({
  calls: [] as string[],
  row: {
    id: 1,
    currentQueueItemId: null,
    positionSeconds: 3,
    isPlaying: true,
    vocalsGain: 0.5,
    hostUserId: null,
    playerUserId: null,
  },
}));

vi.mock("../db.js", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      calls.push(strings.join("?").includes("FOR UPDATE") ? "lock" : "query");
      return [];
    },
    playbackState: {
      findUniqueOrThrow: async () => {
        calls.push("read");
        return { ...row };
      },
    },
    $executeRawUnsafe: async (_sql: string, channel: string, payload: string) => {
      calls.push(`notify:${channel}:${JSON.parse(payload).vocalsGain}`);
      return 1;
    },
  };
  return {
    prisma: {
      $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => {
        calls.push("begin");
        const result = await work(tx);
        calls.push("commit");
        return result;
      },
    },
  };
});

import { notifyPlaybackState } from "./notify.js";

describe("notifyPlaybackState", () => {
  it("locks, reads and notifies inside one transaction so broadcasts follow commit order", async () => {
    await notifyPlaybackState();
    expect(calls).toEqual(["begin", "lock", "read", "notify:playback_state:0.5", "commit"]);
  });
});
