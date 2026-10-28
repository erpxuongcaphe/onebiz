import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createReadDeadline } from "@/lib/supabase/read-deadline";
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("request-local read deadline", () => {
  it("aborts the real SDK transport and bounds a stalled Auth read", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_input, init) => { signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); }));
    const d = createReadDeadline();
    const client = createClient("https://example.supabase.co", "public-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: d.fetch } });
    const result = d.run(() => client.auth.getUser("fake-access-token")).catch(e => e);
    await vi.advanceTimersByTimeAsync(8000);
    expect(signal.aborted).toBe(true); expect((await result).name).toBe("AbortError"); d.dispose();
  });
  it("aborts a database read using the actual SDK, with no write request", async () => {
    let signal!: AbortSignal; let method: string | undefined;
    vi.stubGlobal("fetch", vi.fn((_input, init) => { signal = init.signal; method = init.method; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); }));
    const d = createReadDeadline();
    const client = createClient("https://example.supabase.co", "public-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: d.fetch } });
    const result = d.run(() => client.from("profiles").select("is_active").eq("id", "self").single()).catch(e => e);
    await vi.advanceTimersByTimeAsync(8000); expect(signal.aborted).toBe(true); expect(method).toBe("GET"); expect((await result).name).toBe("AbortError"); d.dispose();
  });
  it("keeps caller cancellation and isolates concurrent request deadlines", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_input, init) => { signals.push(init.signal); return Promise.resolve(new Response("{}")); }));
    const parent = new AbortController(); const own = new AbortController();
    const a = createReadDeadline(1000, parent.signal); const b = createReadDeadline(8000);
    await a.fetch("https://example.test", { signal: own.signal }); await b.fetch("https://example.test");
    parent.abort(); expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    a.dispose(); b.dispose();
  });
  it("disposes timers after success and never starts an operation after abort", async () => {
    const d = createReadDeadline(); await expect(d.run(() => Promise.resolve("ok"))).resolves.toBe("ok"); d.dispose();
    vi.advanceTimersByTime(20_000); expect(d.aborted).toBe(false);
    const parent = new AbortController(); parent.abort(); const aborted = createReadDeadline(8000, parent.signal); const op = vi.fn();
    await expect(aborted.run(op)).rejects.toMatchObject({ name: "AbortError" }); expect(op).not.toHaveBeenCalled(); aborted.dispose();
  });
});
