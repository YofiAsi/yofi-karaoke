// Runs at most a fixed number of tasks at once with a bounded wait queue, and lets identical in flight keys share one task.
export type Task<T> = () => Promise<T>;

export class LimiterBusyError extends Error {
  constructor() {
    super("limiter_busy");
  }
}

export function createConcurrencyLimiter(maxConcurrent: number, maxWaiting = Infinity) {
  let running = 0;
  const waiting: Array<() => void> = [];

  function releaseSlot(): void {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }

  async function acquireSlot(): Promise<void> {
    if (running < maxConcurrent) {
      running += 1;
      return;
    }
    if (waiting.length >= maxWaiting) throw new LimiterBusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  return {
    async run<T>(task: Task<T>): Promise<T> {
      await acquireSlot();
      try {
        return await task();
      } finally {
        releaseSlot();
      }
    },
    active: () => running,
    pending: () => waiting.length,
  };
}

export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, task: Task<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = task().finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    size: () => inFlight.size,
  };
}
