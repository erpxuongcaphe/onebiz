/**
 * Runs one async job at a time and coalesces queued work to the latest value.
 * POS auto-save uses this to prevent overlapping writes while still persisting
 * the newest cart snapshot that arrived during a slow request.
 */
export class LatestOnlyAsyncQueue<T> {
  private latest: T | null = null;
  private running = false;
  private stopped = false;
  private idleWaiters = new Set<() => void>();

  constructor(private readonly worker: (value: T) => Promise<void>) {}

  enqueue(value: T): void {
    if (this.stopped) return;
    this.latest = value;
    void this.drain();
  }

  clearPending(matches: (value: T) => boolean = () => true): void {
    if (this.latest !== null && matches(this.latest)) this.latest = null;
  }

  /** Wait for already-started writes before handing the draft to checkout. */
  whenIdle(): Promise<void> {
    if (!this.running && this.latest === null) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  stop(): void {
    this.stopped = true;
    this.latest = null;
  }

  private async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;

    try {
      while (!this.stopped && this.latest !== null) {
        const value = this.latest;
        this.latest = null;
        await this.worker(value);
      }
    } finally {
      this.running = false;
      if (!this.stopped && this.latest !== null) void this.drain();
      else {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    }
  }
}
