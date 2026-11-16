// Cached, deduplicated, concurrency capped and per user rate limited YouTube search.
import type { SearchResultItem } from "@karaoke/shared";
import { createTtlCache } from "./ttlCache.js";
import { createConcurrencyLimiter, createSingleFlight } from "./concurrency.js";
import { createRateLimiter } from "./rateLimiter.js";
import { normalizeQuery } from "./results.js";

export type SearchFn = (query: string) => Promise<SearchResultItem[]>;

export interface SearchServiceOptions {
  search: SearchFn;
  now?: () => number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  maxConcurrent?: number;
  perUserLimit?: number;
  rateWindowMs?: number;
}

export type SearchOutcome =
  | { kind: "ok"; results: SearchResultItem[] }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export const SEARCH_DEFAULTS = {
  cacheTtlMs: 10 * 60_000,
  cacheMaxEntries: 500,
  maxConcurrent: 2,
  perUserLimit: 20,
  rateWindowMs: 60_000,
};

export function createSearchService(options: SearchServiceOptions) {
  const settings = { ...SEARCH_DEFAULTS, ...options };
  const cache = createTtlCache<SearchResultItem[]>({
    ttlMs: settings.cacheTtlMs,
    maxEntries: settings.cacheMaxEntries,
    now: settings.now,
  });
  const limiter = createConcurrencyLimiter(settings.maxConcurrent);
  const singleFlight = createSingleFlight<SearchResultItem[]>();
  const rateLimiter = createRateLimiter({
    limit: settings.perUserLimit,
    windowMs: settings.rateWindowMs,
    now: settings.now,
  });

  async function fetchAndCache(key: string): Promise<SearchResultItem[]> {
    const results = await limiter.run(() => settings.search(key));
    cache.set(key, results);
    return results;
  }

  return {
    async search(userId: string, query: string): Promise<SearchOutcome> {
      const key = normalizeQuery(query);
      const cached = cache.get(key);
      if (cached) return { kind: "ok", results: cached };
      const decision = rateLimiter.tryAcquire(userId);
      if (!decision.allowed) {
        return { kind: "rate_limited", retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000) };
      }
      return { kind: "ok", results: await singleFlight.run(key, () => fetchAndCache(key)) };
    },
  };
}
