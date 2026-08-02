import { describe, expect, it } from "vitest";
import { LatestOnlyAsyncQueue } from "@/app/pos/lib/latest-only-async-queue";

describe("LatestOnlyAsyncQueue", () => {
  it("persists quantity 1 after a slower quantity 2 save finishes", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let finishLatest!: () => void;
    const latestFinished = new Promise<void>((resolve) => {
      finishLatest = resolve;
    });
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const queue = new LatestOnlyAsyncQueue<number>(async (quantity) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(quantity);
      if (quantity === 2) await firstPending;
      active -= 1;
      if (quantity === 1) finishLatest();
    });

    queue.enqueue(2);
    await Promise.resolve();
    queue.enqueue(1);

    expect(started).toEqual([2]);
    releaseFirst();
    await latestFinished;

    expect(started).toEqual([2, 1]);
    expect(maxActive).toBe(1);
  });

  it("coalesces intermediate cart snapshots to the newest value", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let finishLatest!: () => void;
    const latestFinished = new Promise<void>((resolve) => {
      finishLatest = resolve;
    });
    const saved: number[] = [];

    const queue = new LatestOnlyAsyncQueue<number>(async (quantity) => {
      saved.push(quantity);
      if (quantity === 5) await firstPending;
      if (quantity === 1) finishLatest();
    });

    queue.enqueue(5);
    await Promise.resolve();
    queue.enqueue(4);
    queue.enqueue(3);
    queue.enqueue(1);
    releaseFirst();
    await latestFinished;

    expect(saved).toEqual([5, 1]);
  });
});
