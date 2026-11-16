// Sliding window rate limit per key, bounded in the number of keys it remembers.
export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export function createRateLimiter({ limit, windowMs, maxKeys = 1000, now = Date.now }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  function recentHits(key: string, at: number): number[] {
    return (hits.get(key) ?? []).filter((t) => t > at - windowMs);
  }

  function remember(key: string, timestamps: number[]): void {
    hits.delete(key);
    if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
    hits.set(key, timestamps);
  }

  return {
    tryAcquire(key: string): RateDecision {
      const at = now();
      const recent = recentHits(key, at);
      if (recent.length >= limit) {
        remember(key, recent);
        return { allowed: false, retryAfterMs: recent[0] + windowMs - at };
      }
      remember(key, [...recent, at]);
      return { allowed: true };
    },
  };
}
