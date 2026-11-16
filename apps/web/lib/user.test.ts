import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateStoredUser, storeUser, loadStoredUser, createUser } from "./user";

const STORED = { id: "8b1a9953-c461-4296-8c4c-1f0e9b3a6c2d", name: "Alice", isHost: false };

function installLocalStorage(): void {
  const items = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    },
  });
}

function respondWith(status: number, body: unknown) {
  return vi.fn(
    async (_path: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

describe("validateStoredUser()", () => {
  beforeEach(installLocalStorage);
  afterEach(() => vi.unstubAllGlobals());

  it("returns null without calling the API when nothing is stored", async () => {
    const fetchMock = respondWith(200, STORED);
    vi.stubGlobal("fetch", fetchMock);
    expect(await validateStoredUser()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears local state when the API answers 401", async () => {
    storeUser(STORED);
    vi.stubGlobal("fetch", respondWith(401, { error: "unauthenticated" }));
    expect(await validateStoredUser()).toBeNull();
    expect(loadStoredUser()).toBeNull();
  });

  it("refreshes local state from the API on success", async () => {
    storeUser(STORED);
    const fresh = { ...STORED, isHost: true };
    const fetchMock = respondWith(200, fresh);
    vi.stubGlobal("fetch", fetchMock);
    expect(await validateStoredUser()).toEqual(fresh);
    expect(loadStoredUser()).toEqual(fresh);
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me", expect.anything());
  });

  it("keeps local state on non auth errors such as an outage", async () => {
    storeUser(STORED);
    vi.stubGlobal("fetch", respondWith(503, { error: "unavailable" }));
    expect(await validateStoredUser()).toEqual(STORED);
    expect(loadStoredUser()).toEqual(STORED);
  });
});

describe("createUser()", () => {
  beforeEach(installLocalStorage);
  afterEach(() => vi.unstubAllGlobals());

  it("sends the PIN only when one is given", async () => {
    const fetchMock = respondWith(201, STORED);
    vi.stubGlobal("fetch", fetchMock);
    await createUser("Alice");
    await createUser("Host", "2468");
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies).toEqual([{ name: "Alice" }, { name: "Host", pin: "2468" }]);
  });
});
