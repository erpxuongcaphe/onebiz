import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshScheduler } from "@/lib/refresh-scheduler";
const deferred = () => { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("background read scheduler", () => {
  it("coalesces event bursts without postponing the first pending update", () => {
    const refresh = vi.fn(); const s = createRefreshScheduler(refresh, () => true);
    s.request(); vi.advanceTimersByTime(300); s.request(); vi.advanceTimersByTime(50);
    expect(refresh).toHaveBeenCalledTimes(1); s.dispose();
  });
  it("does not overlap a slow read and preserves exactly one trailing event refresh", async () => {
    const first = deferred(); const refresh = vi.fn().mockReturnValueOnce(first.promise);
    const s = createRefreshScheduler(refresh, () => true); s.poll();
    for (let i = 0; i < 20; i++) { s.request(); s.poll(); }
    vi.advanceTimersByTime(90_000); expect(refresh).toHaveBeenCalledTimes(1);
    first.resolve(); await Promise.resolve(); vi.advanceTimersByTime(350);
    expect(refresh).toHaveBeenCalledTimes(2); s.dispose();
  });
  it("polling ticks alone do not queue work behind a slow request", async () => {
    const first = deferred(); const refresh = vi.fn().mockReturnValue(first.promise);
    const s = createRefreshScheduler(refresh, () => true); s.poll(); s.poll(); s.poll();
    first.resolve(); await Promise.resolve(); vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1); s.dispose();
  });
  it("waits for visibility/network restoration rather than running while hidden/offline", () => {
    let available = false; const refresh = vi.fn(); const s = createRefreshScheduler(refresh, () => available);
    s.request(); s.poll(); vi.advanceTimersByTime(120_000); expect(refresh).not.toHaveBeenCalled();
    available = true; s.request(); vi.advanceTimersByTime(350); expect(refresh).toHaveBeenCalledTimes(1); s.dispose();
  });
  it("backs off failures, cannot be bypassed by events, and resets after success", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    const s = createRefreshScheduler(refresh, () => true); s.poll(); await Promise.resolve();
    for (let i = 0; i < 10; i++) { s.request(0); s.poll(); }
    vi.advanceTimersByTime(4999); expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9999); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(3);
    s.request(); vi.advanceTimersByTime(350); expect(refresh).toHaveBeenCalledTimes(4); s.dispose();
  });
  it("handles synchronous exceptions without an unhandled rejection", () => {
    const refresh = vi.fn().mockImplementationOnce(() => { throw new Error("read"); });
    const s = createRefreshScheduler(refresh, () => true); s.poll(); vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(2); s.dispose();
  });
  it("disposal blocks queued callbacks and late completion from the previous scope", async () => {
    const first = deferred(); const oldRead = vi.fn().mockReturnValue(first.promise);
    const old = createRefreshScheduler(oldRead, () => true); old.poll(); old.request(); old.dispose();
    const newRead = vi.fn(); const current = createRefreshScheduler(newRead, () => true); current.poll();
    first.resolve(); await Promise.resolve(); old.request(0); vi.advanceTimersByTime(60_000);
    expect(oldRead).toHaveBeenCalledTimes(1); expect(newRead).toHaveBeenCalledTimes(1); current.dispose();
  });
});
