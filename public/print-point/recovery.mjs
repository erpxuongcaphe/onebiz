// No retry here: a timed-out claim may already have been committed on the server.
export function createAgentRpc(config, fetchRequest = fetch, timeoutMs = 15000, now = Date.now) {
  const endpoint = new URL('/rest/v1/rpc/fnb_print_agent_v1', config.url);
  let retryAt = 0, failures = 0;
  return async (action, data = {}) => {
    // Share the cooldown with background heartbeat. An invalid/revoked receiver
    // must not keep hammering the database while its configuration is repaired.
    if (now() < retryAt) {
      const error = new Error('PRINT_RPC_BACKOFF');
      error.retryAfterMs = retryAt - now();
      throw error;
    }
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('PRINT_RPC_TIMEOUT')); }, timeoutMs);
    });
    try {
      const result = await Promise.race([deadline, (async () => {
        const response = await fetchRequest(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publicKey },
          body: JSON.stringify({ p_point: config.pointId, p_token: config.token, p_action: action, p_data: data }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`PRINT_RPC_HTTP_${response.status}`);
          // Recognize only this explicit server code, never log a response which
          // could contain configuration or job data. Deadline still covers body.
          if (action === 'finish' && response.status === 400 && response.json) {
            const failure = await response.json().catch(() => null);
            error.claimExpired = failure?.message === 'PRINT_CLAIM_EXPIRED';
          }
          if (response.status === 401 || response.status === 403) error.retryAfterMs = 300000;
          if (response.status === 429) {
            const header = response.headers?.get('retry-after');
            const seconds = header && /^\d+$/.test(header) ? Number(header) : 0;
            error.retryAfterMs = Math.max(30000, Math.min(900000, seconds * 1000));
          }
          throw error;
        }
        // The deadline covers headers AND the response body, including an uncooperative fetch.
        return await response.json();
      })()]);
      // A slower background heartbeat must not erase a newer failure/cooldown.
      if (now() >= retryAt) { failures = 0; retryAt = 0; }
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('PRINT_RPC_FAILED');
      failures++;
      error.retryAfterMs = error.retryAfterMs || Math.min(30000, 5000 * 2 ** Math.min(failures - 1, 3));
      retryAt = Math.max(retryAt, now() + error.retryAfterMs);
      throw error;
    } finally { clearTimeout(timer); }
  };
}

// Progress is advanced by the queue, never by background printer discovery/heartbeat.
export function createProgressWatchdog(onStall, timeoutMs = 90000, now = Date.now) {
  let lastProgress = now();
  const timer = setInterval(() => {
    if (now() - lastProgress >= timeoutMs) { clearInterval(timer); onStall(); }
  }, Math.min(5000, timeoutMs));
  timer.unref?.();
  return { pulse() { lastProgress = now(); }, close() { clearInterval(timer); } };
}
