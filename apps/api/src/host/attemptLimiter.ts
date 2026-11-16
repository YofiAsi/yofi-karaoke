interface FailureWindow {
  count: number;
  resetAt: number;
}

export interface AttemptLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
  reset(key: string): void;
}

export function createAttemptLimiter(
  maxFailures: number,
  windowMs: number,
  now: () => number = Date.now,
): AttemptLimiter {
  const failures = new Map<string, FailureWindow>();

  function activeWindow(key: string): FailureWindow | undefined {
    const window = failures.get(key);
    if (window && window.resetAt <= now()) {
      failures.delete(key);
      return undefined;
    }
    return window;
  }

  function pruneExpired(): void {
    for (const key of failures.keys()) activeWindow(key);
  }

  return {
    isBlocked(key) {
      return (activeWindow(key)?.count ?? 0) >= maxFailures;
    },
    recordFailure(key) {
      pruneExpired();
      const window = activeWindow(key) ?? { count: 0, resetAt: now() + windowMs };
      window.count += 1;
      failures.set(key, window);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
