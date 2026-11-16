import { describe, expect, it } from "vitest";
import { loadDisplayPreference, preferenceKey, saveDisplayPreference } from "./lyricsDisplayPreference";
import { readerForItem } from "./livePosition";

const IDS = ["scroll", "karaoke"];

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const failing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("display preference", () => {
  it("returns the page default when nothing is stored", () => {
    expect(loadDisplayPreference(memoryStorage(), "tv", IDS, "karaoke")).toBe("karaoke");
  });

  it("remembers the choice per page", () => {
    const storage = memoryStorage();
    saveDisplayPreference(storage, "home", "karaoke");
    expect(loadDisplayPreference(storage, "home", IDS, "scroll")).toBe("karaoke");
    expect(loadDisplayPreference(storage, "tv", IDS, "scroll")).toBe("scroll");
  });

  it("ignores an unknown stored display", () => {
    const storage = memoryStorage();
    storage.setItem(preferenceKey("tv"), "retired");
    expect(loadDisplayPreference(storage, "tv", IDS, "karaoke")).toBe("karaoke");
  });

  it("works without storage or when storage throws", () => {
    expect(loadDisplayPreference(null, "home", IDS, "scroll")).toBe("scroll");
    expect(loadDisplayPreference(failing, "home", IDS, "scroll")).toBe("scroll");
    expect(() => saveDisplayPreference(failing, "home", "karaoke")).not.toThrow();
    expect(() => saveDisplayPreference(null, "home", "karaoke")).not.toThrow();
  });
});

describe("readerForItem", () => {
  const reader = { queueItemId: "a", read: () => 1 };

  it("keeps the engine reader only for the current item", () => {
    expect(readerForItem("a", reader)).toBe(reader);
    expect(readerForItem("b", reader)).toBeNull();
    expect(readerForItem(null, reader)).toBeNull();
  });
});
