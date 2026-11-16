// Sends at most one value per interval, always delivering the latest value last.
export interface Throttle<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
}

export function createThrottle<T>(send: (value: T) => void, intervalMs: number): Throttle<T> {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function sendNow(value: T) {
    clearTimer();
    pending = null;
    lastSentAt = Date.now();
    send(value);
  }

  function flush() {
    if (pending) sendNow(pending.value);
  }

  function push(value: T) {
    const wait = lastSentAt + intervalMs - Date.now();
    if (wait <= 0) return sendNow(value);
    pending = { value };
    if (timer === null) timer = setTimeout(flush, wait);
  }

  function cancel() {
    clearTimer();
    pending = null;
  }

  return { push, flush, cancel };
}
