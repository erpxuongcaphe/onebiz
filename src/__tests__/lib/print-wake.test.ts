import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrintWake } from '../../../public/print-point/wake.mjs';
import { handlePrintWake } from '../../../supabase/functions/print-wake/handler.mjs';
const config = { url: 'https://test.invalid', pointId: '20000000-0000-0000-0000-000000000001', token: 'a'.repeat(64), publicKey: 'public' };
const encode = new TextEncoder();
afterEach(() => vi.useRealTimers());
describe('private print wake', () => {
  it('wakes idle immediately and coalesces a burst, but carries no print command', async () => {
    vi.useFakeTimers(); let stream!: ReadableStreamDefaultController;
    const fetchRequest = vi.fn<typeof fetch>(async (_url, _options) => new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const wake = createPrintWake(config, { fetchRequest });
    await vi.advanceTimersByTimeAsync(0);
    stream.enqueue(encode.encode('event: ready\ndata: 1\n\n'));
    await vi.advanceTimersByTimeAsync(0); expect(wake.connected()).toBe(true); await wake.wait(15000);
    let elapsed = false; const wait = wake.wait(15000).then(() => { elapsed = true; });
    stream.enqueue(encode.encode('event: wake\ndata: 1\n\n'.repeat(100)));
    await vi.advanceTimersByTimeAsync(0); await wait; expect(elapsed).toBe(true);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(String(fetchRequest.mock.calls[0][0])).not.toContain(config.token);
    wake.close(); stream.close();
  });
  it('falls back when unavailable without turning disabled mode into a busy loop', async () => {
    vi.useFakeTimers(); const fetchRequest = vi.fn();
    const wake = createPrintWake({ ...config, wakeEnabled: false }, { fetchRequest });
    let finished = false; void wake.wait(5000).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(4999); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(finished).toBe(true); expect(fetchRequest).not.toHaveBeenCalled(); wake.close();
  });
  it('keeps invalid credentials on five-minute backoff instead of reconnect flooding', async () => {
    vi.useFakeTimers(); const fetchRequest = vi.fn(async () => new Response('', { status: 401 }));
    const wake = createPrintWake(config, { fetchRequest, random: () => 0 });
    await vi.advanceTimersByTimeAsync(299999); expect(fetchRequest).toHaveBeenCalledTimes(1); expect(wake.connected()).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(fetchRequest).toHaveBeenCalledTimes(2); wake.close();
  });
  it('ignores malformed events and does not mark online until subscribed', async () => {
    vi.useFakeTimers(); let stream!: ReadableStreamDefaultController;
    const wake = createPrintWake(config, { fetchRequest: async () => new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { 'content-type': 'text/event-stream' } }) });
    await vi.advanceTimersByTimeAsync(0);
    stream.enqueue(encode.encode('event: wake\ndata: 1\n\nevent: print\ndata: command\n\n'));
    await vi.advanceTimersByTimeAsync(0); expect(wake.connected()).toBe(false);
    wake.close(); stream.close();
  });
  it('relay rejects unauthorized point before opening any realtime connection', async () => {
    const subscribe = vi.fn(); const response = await handlePrintWake(new Request('https://relay.invalid', { method: 'POST', body: JSON.stringify(config) }), { authorize: async () => false, subscribe });
    expect(response.status).toBe(401); expect(subscribe).not.toHaveBeenCalled();
  });
  it('relay streams only constant hints and cleans up disconnected client', async () => {
    vi.useFakeTimers(); const cleanup = vi.fn(); let notify!: () => void;
    const response = await handlePrintWake(new Request('https://relay.invalid', { method: 'POST', body: JSON.stringify(config) }), {
      authorize: async () => true,
      subscribe: (id: string, wake: () => void, ready: () => void) => { expect(id).toBe(config.pointId); notify = wake; ready(); return cleanup; },
    });
    const reader = response.body!.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toBe('event: ready\ndata: 1\n\n'); notify();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: wake\ndata: 1\n\n');
    await reader.cancel(); expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it('relay renews at its lifetime limit and unsubscribes exactly once', async () => {
    vi.useFakeTimers(); const cleanup = vi.fn(), waitUntil = vi.fn();
    const response = await handlePrintWake(new Request('https://relay.invalid', { method: 'POST', body: JSON.stringify(config) }), {
      authorize: async () => true, subscribe: () => cleanup, waitUntil,
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100000);
    await waitUntil.mock.calls[0][0];
    expect(cleanup).toHaveBeenCalledTimes(1);
    await response.body!.cancel(); expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it('relay rejects oversized or non-string credentials before a database call', async () => {
    const authorize = vi.fn(), subscribe = vi.fn();
    for (const body of ['x'.repeat(1025), JSON.stringify({ ...config, pointId: [config.pointId] })]) {
      const response = await handlePrintWake(new Request('https://relay.invalid', { method: 'POST', body }), { authorize, subscribe });
      expect([401, 413]).toContain(response.status);
    }
    expect(authorize).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('relay subscription failure closes without retaining timers', async () => {
    vi.useFakeTimers(); const waitUntil = vi.fn();
    const response = await handlePrintWake(new Request('https://relay.invalid', { method: 'POST', body: JSON.stringify(config) }), {
      authorize: async () => true, subscribe: () => { throw new Error('offline'); }, waitUntil,
    });
    expect((await response.body!.getReader().read()).done).toBe(true);
    await waitUntil.mock.calls[0][0]; expect(vi.getTimerCount()).toBe(0);
  });
});
