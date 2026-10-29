// An idle receiver needs a bounded latency, not a permanent one-second DB loop.
// Receiving a ticket resets the idle window; queued bursts drain without a pause.
export function createIdlePolling(now = Date.now) {
  let idleSince = now();
  return {
    received() { idleSince = now(); },
    emptyDelayMs() {
      const idleMs = Math.max(0, now() - idleSince);
      return idleMs < 10000 ? 1000 : idleMs < 30000 ? 2000 : 5000;
    },
  };
}
