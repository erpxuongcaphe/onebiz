/** Request-local transport deadline. No caching and no automatic retries. */
export function createReadDeadline(timeoutMs = 8_000, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const fetchWithDeadline: typeof fetch = (input, init) => {
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = requestSignal ? AbortSignal.any([controller.signal, requestSignal]) : controller.signal;
    return fetch(input, { ...init, signal });
  };
  return {
    fetch: fetchWithDeadline,
    get aborted() { return controller.signal.aborted; },
    // Bound the handler too: an SDK may still be sleeping between Auth retries.
    // Its transports keep the aborted signal, so no subsequent retry can send.
    run<T>(operation: () => PromiseLike<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Read deadline exceeded", "AbortError"));
        if (controller.signal.aborted) { onAbort(); return; }
        controller.signal.addEventListener("abort", onAbort, { once: true });
        try {
          Promise.resolve(operation()).then(resolve, reject)
            .finally(() => controller.signal.removeEventListener("abort", onAbort));
        } catch (error) {
          controller.signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
    },
    dispose() { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); },
  };
}
