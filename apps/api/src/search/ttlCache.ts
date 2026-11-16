// Size bounded cache whose entries expire after a fixed time to live; the oldest entry is evicted first.
export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  size(): number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export function createTtlCache<V>({ ttlMs, maxEntries, now = Date.now }: TtlCacheOptions): TtlCache<V> {
  const entries = new Map<string, Entry<V>>();

  function evictOldest(): void {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      while (entries.size >= maxEntries) evictOldest();
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    size: () => entries.size,
  };
}
