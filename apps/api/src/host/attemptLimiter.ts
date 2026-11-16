import { isIPv6 } from "node:net";

interface FailureWindow {
  count: number;
  resetAt: number;
}

export interface AttemptLimiterOptions {
  maxFailuresPerKey: number;
  maxFailuresGlobal: number;
  windowMs: number;
  maxKeys: number;
  now?: () => number;
}

export interface AttemptLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
  reset(key: string): void;
  clear(): void;
  trackedKeys(): number;
}

const IPV4_MAPPED_PREFIX = "::ffff:";

function expandIPv6(address: string): string[] {
  const [head, tail = ""] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = address.includes("::") ? 8 - headGroups.length - tailGroups.length : 0;
  return [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
}

function ipv6Prefix64(address: string): string {
  const groups = expandIPv6(address.toLowerCase().split("%")[0]);
  return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}

export function clientKeyFromIp(ip: string): string {
  const lowered = ip.toLowerCase();
  if (lowered.startsWith(IPV4_MAPPED_PREFIX) && !isIPv6(lowered.slice(IPV4_MAPPED_PREFIX.length))) {
    return lowered.slice(IPV4_MAPPED_PREFIX.length);
  }
  return isIPv6(lowered) ? ipv6Prefix64(lowered) : lowered;
}

export function createAttemptLimiter(options: AttemptLimiterOptions): AttemptLimiter {
  const { maxFailuresPerKey, maxFailuresGlobal, windowMs, maxKeys } = options;
  const now = options.now ?? Date.now;
  const failures = new Map<string, FailureWindow>();
  let global: FailureWindow | undefined;

  function isExpired(window: FailureWindow | undefined): boolean {
    return !window || window.resetAt <= now();
  }

  function activeWindow(key: string): FailureWindow | undefined {
    const window = failures.get(key);
    if (window && isExpired(window)) {
      failures.delete(key);
      return undefined;
    }
    return window;
  }

  function evictOldestIfFull(): void {
    if (failures.size < maxKeys) return;
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }

  function bump(window: FailureWindow | undefined): FailureWindow {
    const next = window ?? { count: 0, resetAt: now() + windowMs };
    next.count += 1;
    return next;
  }

  function globalCount(): number {
    return isExpired(global) ? 0 : (global?.count ?? 0);
  }

  return {
    isBlocked(key) {
      if (globalCount() >= maxFailuresGlobal) return true;
      return (activeWindow(key)?.count ?? 0) >= maxFailuresPerKey;
    },
    recordFailure(key) {
      global = bump(isExpired(global) ? undefined : global);
      const existing = activeWindow(key);
      if (!existing) evictOldestIfFull();
      failures.set(key, bump(existing));
    },
    reset(key) {
      failures.delete(key);
    },
    clear() {
      failures.clear();
      global = undefined;
    },
    trackedKeys() {
      return failures.size;
    },
  };
}
