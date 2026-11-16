/* Runs GPU tasks strictly one at a time: lower tier first, then lower order, then first come first served. */

export interface GpuPriority {
  tier: number;
  order: number;
}

interface Waiting {
  priority: GpuPriority;
  seq: number;
  start: () => Promise<void>;
}

function comesFirst(a: Waiting, b: Waiting): boolean {
  if (a.priority.tier !== b.priority.tier) return a.priority.tier < b.priority.tier;
  if (a.priority.order !== b.priority.order) return a.priority.order < b.priority.order;
  return a.seq < b.seq;
}

export class GpuLane {
  private waiting: Waiting[] = [];
  private busy = false;
  private seq = 0;

  run<T>(priority: GpuPriority, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => Promise.resolve().then(task).then(resolve, reject);
      this.waiting.push({ priority, seq: this.seq++, start });
      this.pump();
    });
  }

  get queued(): number {
    return this.waiting.length;
  }

  private takeNext(): Waiting {
    let best = 0;
    for (let i = 1; i < this.waiting.length; i++) {
      if (comesFirst(this.waiting[i], this.waiting[best])) best = i;
    }
    return this.waiting.splice(best, 1)[0];
  }

  private pump(): void {
    if (this.busy || this.waiting.length === 0) return;
    this.busy = true;
    void this.takeNext()
      .start()
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }
}
