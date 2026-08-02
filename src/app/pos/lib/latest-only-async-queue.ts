/**
 * Runs one async job at a time and coalesces queued work to the latest value.
 * POS auto-save uses this to prevent overlapping writes while still persisting
 * the newest cart snapshot that arrived during a slow request.
 */
export class LatestOnlyAsyncQueue<T> {
  private latest: T | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly worker: (value: T) => Promise<void>) {}

  enqueue(value: T): void {
    if (this.stopped) return;
    this.latest = value;
    void this.drain();
  }

  clearPending(): void {
    this.latest = null;
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
    }
  }
}
