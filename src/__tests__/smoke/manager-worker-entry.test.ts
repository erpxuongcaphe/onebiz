import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/sw-manager.js", "utf8");
function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    keys: vi.fn().mockResolvedValue(["onebiz-manager-v4", "onebiz-manager-v5", "onebiz-pos-v2", "unrelated-cache"]),
    delete: vi.fn().mockResolvedValue(true), open: vi.fn().mockResolvedValue(cache), match: vi.fn(),
  };
  const fetch = vi.fn();
  const self = { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), skipWaiting: vi.fn(), clients: { claim: vi.fn() } };
  runInNewContext(source, { self, caches, fetch, URL, Promise, Response: class { constructor(public body: string, public options: unknown) {} } });
  const navigate = async (path: string, method = "GET") => {
    let result: Promise<unknown> | undefined;
    listeners.get("fetch")!({ request: { url: path.startsWith("http") ? path : "https://onebiz.com.vn" + path, method, mode: "navigate", destination: "document" }, respondWith: (value: Promise<unknown>) => { result = value; } });
    return await result;
  };
  return { listeners, cache, caches, fetch, self, navigate };
}

describe("manager shortcut worker compatibility", () => {
  it("retires only its own previous caches", async () => {
    const w = worker(); let pending: Promise<unknown> | undefined;
    w.listeners.get("activate")!({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
    expect(w.caches.delete.mock.calls).toEqual([["onebiz-manager-v4"]]);
    expect(w.self.clients.claim).toHaveBeenCalledOnce();
  });
  it.each(["/manager", "/manager/?branch=all"])("does not cache a redirected response for %s", async path => {
    const w = worker(); const response = { status: 200, clone: vi.fn() };
    w.fetch.mockResolvedValue(response);
    expect(await w.navigate(path)).toBe(response);
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("does not restore the retired dashboard when offline", async () => {
    const w = worker(); const offline = { status: 503 };
    w.fetch.mockRejectedValue(new Error("offline")); w.caches.match.mockResolvedValue(offline);
    expect(await w.navigate("/manager?branch=all")).toBe(offline);
    expect(w.caches.match.mock.calls).toEqual([["/offline.html"]]);
  });
  it("preserves the existing network-first ERP navigation", async () => {
    const w = worker(); const copy = {}; const response = { status: 200, clone: () => copy };
    w.fetch.mockResolvedValue(response);
    expect(await w.navigate("/?branch=all")).toBe(response);
    await Promise.resolve();
    expect(w.cache.put).toHaveBeenCalledWith(expect.objectContaining({ url: "https://onebiz.com.vn/?branch=all" }), copy);
  });
  it.each([["/api/orders", "GET"], ["/pos/fnb", "POST"], ["https://project.supabase.co/rest/v1/invoices", "GET"], ["http://127.0.0.1:3000/manager", "GET"]])("does not intercept %s %s", async (path, method) => {
    const w = worker();
    expect(await w.navigate(path, method)).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
  });
});
