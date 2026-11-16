// Keeps one request in flight, sends only the latest value when it settles, at most once per interval.
export interface LatestSender<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
}

export function createLatestSender<T>(send: (value: T) => Promise<unknown>, intervalMs: number): LatestSender<T> {
  let pending: { value: T } | null = null;
  let inFlight = false;
  let urgent = false;
  let cancelled = false;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function settle() {
    inFlight = false;
    schedule();
  }

  function dispatch() {
    clearTimer();
    if (!pending || inFlight || cancelled) return;
    const { value } = pending;
    pending = null;
    urgent = false;
    inFlight = true;
    lastSentAt = Date.now();
    send(value).then(settle, settle);
  }

  function schedule() {
    if (!pending || inFlight || cancelled) return;
    const wait = urgent ? 0 : lastSentAt + intervalMs - Date.now();
    if (wait <= 0) return dispatch();
    if (timer === null) timer = setTimeout(dispatch, wait);
  }

  return {
    push(value: T) {
      pending = { value };
      schedule();
    },
    flush() {
      urgent = true;
      schedule();
    },
    cancel() {
      cancelled = true;
      clearTimer();
      pending = null;
    },
  };
}
