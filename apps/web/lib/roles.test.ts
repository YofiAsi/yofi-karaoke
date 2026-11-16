import { describe, expect, it } from "vitest";
import { canRemoveItem, isCurrentHost, isPlayerDevice } from "./roles";

const HOST = { id: "host" };
const GUEST = { id: "guest" };
const PLAYBACK = { hostUserId: "host", playerUserId: "host" };

describe("roles", () => {
  it("derives host and player from the playback state, not from a stored flag", () => {
    expect(isCurrentHost(HOST, PLAYBACK)).toBe(true);
    expect(isCurrentHost(GUEST, PLAYBACK)).toBe(false);
    expect(isCurrentHost(HOST, { ...PLAYBACK, hostUserId: "other" })).toBe(false);
    expect(isPlayerDevice(HOST, PLAYBACK)).toBe(true);
    expect(isPlayerDevice(GUEST, PLAYBACK)).toBe(false);
  });

  it("treats unknown playback state or user as no role", () => {
    expect(isCurrentHost(HOST, null)).toBe(false);
    expect(isPlayerDevice(null, PLAYBACK)).toBe(false);
  });

  it("lets the requester or the host remove an item", () => {
    const item = { requestedByUserId: "guest" };
    expect(canRemoveItem(GUEST, item, false)).toBe(true);
    expect(canRemoveItem({ id: "someone" }, item, false)).toBe(false);
    expect(canRemoveItem({ id: "someone" }, item, true)).toBe(true);
  });
});
