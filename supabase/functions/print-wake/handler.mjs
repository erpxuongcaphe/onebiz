const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Injected adapter keeps authentication/stream lifecycle testable without a live
// database. Never forward service credentials, customer data or arbitrary topics.
export async function handlePrintWake(request, adapter) {
  const deny = status => new Response('Print wake unavailable', { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return deny(405);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return deny(400);
    let text = '', bytes = 0; const decoder = new TextDecoder();
    const timer = setTimeout(() => void reader.cancel(), 5000);
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length; if (bytes > 1024) { await reader.cancel(); return deny(413); }
        text += decoder.decode(part.value, { stream: true });
      }
      input = JSON.parse(text);
    } finally { clearTimeout(timer); reader.releaseLock(); }
  } catch { return deny(400); }
  if (typeof input?.pointId !== 'string' || typeof input?.token !== 'string' || !uuid.test(input.pointId) || !/^[0-9a-f]{64}$/.test(input.token)) return deny(401);
  try { if (!await adapter.authorize(input.pointId, input.token)) return deny(401); }
  catch { return deny(503); }

  let cleanup = () => {}, closeStream, closed = false, timer, heartbeat, finishLifetime;
  const lifetime = new Promise(resolve => { finishLifetime = resolve; });
  const encoder = new TextEncoder();
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); clearInterval(heartbeat);
    request.signal.removeEventListener('abort', close);
    cleanup(); closeStream?.(); finishLifetime();
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = event => { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: 1\n\n`)); };
      closeStream = () => { try { controller.close(); } catch {} };
      request.signal.addEventListener('abort', close, { once: true });
      if (request.signal.aborted) { close(); return; }
      let last = 0;
      // The adapter only subscribes using server credentials, and never exposes
      // this topic to anonymous Realtime clients. No RLS policy is opened.
      try { cleanup = adapter.subscribe(input.pointId, () => {
        const time = Date.now(); if (time - last < 250) return; last = time; send('wake');
      }, () => { send('ready'); }, close); } catch { close(); return; }
      if (closed) { cleanup(); return; }
      heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 15000);
      timer = setTimeout(close, 100000);
    },
    cancel() { close(); },
  });
  adapter.waitUntil?.(lifetime);
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } });
}
