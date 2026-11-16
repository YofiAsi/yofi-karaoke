import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttlCache.js";
import { createRateLimiter } from "./rateLimiter.js";
import { createConcurrencyLimiter } from "./concurrency.js";
import { normalizeQuery, toSearchResults } from "./results.js";

describe("ttl cache", () => {
  it("evicts the oldest entry when full", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.size()).toBe(2);
  });
});

describe("rate limiter", () => {
  it("forgets the oldest key beyond its bound", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 1, now: () => 0 });
    expect(limiter.tryAcquire("a").allowed).toBe(true);
    expect(limiter.tryAcquire("b").allowed).toBe(true);
    expect(limiter.tryAcquire("a").allowed).toBe(true);
  });
});

describe("concurrency limiter", () => {
  it("never exceeds the cap when a slot is handed over", async () => {
    const limiter = createConcurrencyLimiter(1);
    let peak = 0;
    const task = async () => {
      peak = Math.max(peak, limiter.active());
      await Promise.resolve();
    };
    await Promise.all([limiter.run(task), limiter.run(task), limiter.run(task)]);
    expect(peak).toBe(1);
    expect(limiter.active()).toBe(0);
  });
});

describe("search results", () => {
  it("normalizes case, spacing and unicode form", () => {
    expect(normalizeQuery("  Hello   WORLD ")).toBe("hello world");
    expect(normalizeQuery("שלום  עולם")).toBe("שלום עולם");
  });

  it("drops live and overly long videos and keeps six", () => {
    const entry = (id: string, duration: number, is_live = false) => ({ id, title: id, duration, is_live });
    const entries = [entry("live", 100, true), entry("long", 900), ...Array.from({ length: 8 }, (_, i) => entry(`v${i}`, 200))];
    const results = toSearchResults(entries);
    expect(results.map((r) => r.youtubeVideoId)).toEqual(["v0", "v1", "v2", "v3", "v4", "v5"]);
    expect(results[0]).toMatchObject({ channel: "Unknown", thumbnailUrl: "https://i.ytimg.com/vi/v0/mqdefault.jpg" });
  });
});
