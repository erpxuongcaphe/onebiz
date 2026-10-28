export const AGENT_VERSION = '2026.10.28.1';

// Scheduling a later poll must never replay the failed request itself.
export function createAgentRetryPolicy(random = Math.random) {
  let failures = 0, lastKind = '';
  return {
    success() { failures = 0; lastKind = ''; },
    failure(error) {
      const status = Number(error?.status);
      const denied = status === 401 || status === 403;
      const configuration = denied || status >= 400 && status < 500 && status !== 408 && status !== 429;
      const kind = configuration ? 'configuration' : 'temporary';
      failures = lastKind === kind ? Math.min(10, failures + 1) : 1;
      lastKind = kind;
      const base = configuration ? 60_000 : 5_000;
      const cap = configuration ? 300_000 : 60_000;
      const backoff = Math.min(cap, base * 2 ** (failures - 1));
      const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
      const retryAfter = Number(error?.retryAfterMs);
      const serverWait = Number.isFinite(retryAfter) ? Math.max(0, Math.min(3_600_000, retryAfter)) : 0;
      return {
        delayMs: Math.max(serverWait, Math.min(cap, Math.round(backoff * (1 + jitter * 0.2)))),
        code: denied ? 'PRINT_CONNECTION_REJECTED_CHECK_LOCAL_CONFIG' : configuration ? 'PRINT_REQUEST_REJECTED_CHECK_LOCAL_CONFIG' : 'PRINT_CONNECTION_TEMPORARILY_UNAVAILABLE',
      };
    },
  };
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? Math.min(3_600_000, Math.ceil(delay)) : undefined;
}

/** Remain responsive to shutdown during an intentional cooldown. No RPC or physical send. */
export async function waitForAgentRetry(delayMs, sleep, stopped = () => false) {
  for (let remaining = delayMs; remaining > 0 && !stopped();) {
    const chunk = Math.min(1000, remaining);
    await sleep(chunk);
    remaining -= chunk;
  }
}

// No retry here: a timed-out claim may already have been committed on the server.
export function createAgentRpc(config, fetchRequest = fetch, timeoutMs = 15000) {
  const endpoint = new URL('/rest/v1/rpc/fnb_print_agent_v1', config.url);
  return async (action, data = {}) => {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('PRINT_RPC_TIMEOUT')); }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchRequest(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publicKey, 'User-Agent': `OnebizPrintPoint/${AGENT_VERSION} (Node)` },
          body: JSON.stringify({ p_point: config.pointId, p_token: config.token, p_action: action, p_data: data }),
          signal: controller.signal,
        });
        if (!response.ok) throw Object.assign(new Error(`PRINT_RPC_HTTP_${response.status}`), {
          status: response.status,
          retryAfterMs: retryAfterMilliseconds(response.headers?.get?.('retry-after')),
        });
        // The deadline covers headers AND the response body, including an uncooperative fetch.
        return await response.json();
      })()]);
    } finally { clearTimeout(timer); }
  };
}

// Progress is advanced by the queue, never by background printer discovery/heartbeat.
// A bounded, intentional retry wait may defer the deadline; a hung send never may.
export function createProgressWatchdog(onStall, timeoutMs = 90000, now = Date.now) {
  let lastProgress = now();
  const timer = setInterval(() => {
    if (now() - lastProgress >= timeoutMs) { clearInterval(timer); onStall(); }
  }, Math.min(5000, timeoutMs));
  timer.unref?.();
  return {
    pulse() { lastProgress = now(); },
    deferRetry(delayMs) {
      if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 3_600_000) throw new Error('INVALID_PRINT_RETRY_DELAY');
      lastProgress = now() + delayMs;
    },
    close() { clearInterval(timer); },
  };
}
