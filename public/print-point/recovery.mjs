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
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publicKey },
          body: JSON.stringify({ p_point: config.pointId, p_token: config.token, p_action: action, p_data: data }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`PRINT_RPC_HTTP_${response.status}`);
        // The deadline covers headers AND the response body, including an uncooperative fetch.
        return await response.json();
      })()]);
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
