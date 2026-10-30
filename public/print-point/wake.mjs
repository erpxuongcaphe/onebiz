// Optional receive-only wake channel. A message never contains a bill and never
// prints: it merely interrupts idle sleep before the usual authenticated claim.
export function createPrintWake(config, { fetchRequest = fetch, now = Date.now, random = Math.random } = {}) {
  let stopped = false, online = false, pending = false;
  let waiter, request, reconnectTimer, failures = 0, lastWake = 0;
  const endpoint = new URL('/functions/v1/print-wake', config.url);
  function signal() {
    pending = true;
    if (waiter) { const resolve = waiter; waiter = null; pending = false; resolve(); }
  }
  async function connect() {
    if (stopped || config.wakeEnabled === false) return;
    let retry = 5000, idleTimer, lifetime;
    request = new AbortController();
    const controller = request;
    const arm = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => controller.abort(), 35000); };
    try {
      idleTimer = setTimeout(() => controller.abort(), 10000);
      lifetime = setTimeout(() => controller.abort(), 120000);
      const response = await fetchRequest(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: config.publicKey },
        body: JSON.stringify({ pointId: config.pointId, token: config.token }),
      });
      if (!response.ok) {
        if ([401,403,404].includes(response.status)) retry = 300000;
        if (response.status === 429) retry = Math.max(30000, Math.min(900000, Number(response.headers.get('retry-after')) * 1000 || 30000));
        await response.body?.cancel();
        throw new Error('WAKE_UNAVAILABLE');
      }
      if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('WAKE_INVALID_STREAM');
      arm();
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', received = 0, ready = false;
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > 65536) throw new Error('WAKE_STREAM_TOO_LARGE');
          arm(); buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
          if (buffer.length > 4096) throw new Error('WAKE_FRAME_TOO_LARGE');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (frame === 'event: ready\ndata: 1') { ready = true; online = true; failures = 0; signal(); }
            if (ready && frame === 'event: wake\ndata: 1' && now() - lastWake >= 250) { lastWake = now(); signal(); }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      // Normal server renewal: reconnect with small jitter; queue fallback stays live.
      retry = ready ? 1000 : 5000;
    } catch {
      failures++;
      retry = Math.max(retry, Math.min(60000, 5000 * 2 ** Math.min(failures - 1, 4)));
      // No raw error/URL/body logging: credentials are only in the POST body.
    } finally {
      const wasOnline = online;
      online = false; controller.abort(); clearTimeout(idleTimer); clearTimeout(lifetime);
      // Do not interrupt a failure cooldown in the caller. Only idle wait uses signal.
      if (wasOnline) signal();
      if (!stopped) reconnectTimer = setTimeout(connect, retry + Math.floor(random() * 1000));
    }
  }
  void connect();
  return {
    connected: () => online,
    wait(ms) {
      if (stopped || pending) { pending = false; return Promise.resolve(); }
      return new Promise(resolve => {
        const finish = () => { clearTimeout(timer); if (waiter === finish) waiter = null; resolve(); };
        const timer = setTimeout(finish, ms); waiter = finish;
      });
    },
    close() { stopped = true; online = false; clearTimeout(reconnectTimer); request?.abort(); signal(); },
  };
}
