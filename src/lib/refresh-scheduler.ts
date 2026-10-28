/** Schedules background reads only. Never use this to retry writes or print jobs. */
export function createRefreshScheduler(refresh: () => void | Promise<void>, canRun: () => boolean) {
  let disposed = false;
  let running = false;
  let pending = false;
  let failures = 0;
  let retryAfter = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = 0;

  const schedule = (delay: number) => {
    if (disposed || !canRun()) return;
    const due = Math.max(Date.now() + delay, retryAfter);
    // A later event must not postpone an already scheduled update indefinitely.
    if (timer && dueAt <= due) return;
    clearTimeout(timer);
    dueAt = due;
    timer = setTimeout(() => { timer = undefined; run(); }, Math.max(0, due - Date.now()));
  };
  const complete = (failed: boolean) => {
    running = false;
    if (disposed) return;
    if (failed) {
      failures = Math.min(failures + 1, 6);
      const delay = Math.min(120_000, 5_000 * 2 ** (failures - 1));
      retryAfter = Date.now() + Math.round(delay * (1 + Math.random() * 0.2));
      pending = true;
    } else {
      failures = 0;
      retryAfter = 0;
    }
    if (pending) schedule(failed ? 0 : 350);
  };
  const run = () => {
    if (disposed || running || !canRun()) return;
    if (Date.now() < retryAfter) { pending = true; schedule(0); return; }
    clearTimeout(timer);
    timer = undefined;
    pending = false;
    running = true;
    try {
      const result = refresh();
      if (result && typeof result.then === "function") {
        void result.then(() => complete(false), () => complete(true));
      } else complete(false);
    } catch { complete(true); }
  };
  return {
    request(delay = 350) {
      if (disposed) return;
      pending = true;
      if (!running) schedule(delay);
    },
    // A slow request must not accumulate more work from every polling tick.
    poll() { if (!running) run(); },
    dispose() { disposed = true; pending = false; clearTimeout(timer); },
  };
}
