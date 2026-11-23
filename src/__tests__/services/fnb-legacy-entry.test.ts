import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/fnb-legacy-entry/route";

type Records = Partial<Record<string, unknown[]>>;

async function openWith(records: Records | "empty" | "unavailable", offline = false) {
  const html = await GET().text();
  const script = html.match(/<script>([\s\S]+)<\/script>/)![1];
  const message = { textContent: "" };
  const replace = vi.fn();
  const transaction = vi.fn((_stores: string[], _mode: string) => {
    let reads = 0;
    const tx = {
      oncomplete: () => {},
      objectStore(name: string) {
        const rows = (records as Records)[name] ?? [];
        return { openCursor() {
          const read = { result: null as null | { value: unknown; continue: () => void }, onsuccess: () => {} };
          let next = 0;
          const run = () => {
            const value = rows[next++];
            let continuing = false;
            read.result = value === undefined ? null : { value, continue() { continuing = true; queueMicrotask(run); } };
            read.onsuccess();
            if (!continuing && ++reads === 3) tx.oncomplete();
          };
          queueMicrotask(run);
          return read;
        } };
      },
    };
    return tx;
  });
  const close = vi.fn();
  const open = vi.fn(() => {
    const request = {
      transaction: { abort: vi.fn(() => queueMicrotask(() => request.onerror())) },
      result: { transaction, close },
      onupgradeneeded: (_event: { oldVersion: number }) => {},
      onerror: () => {},
      onsuccess: () => {},
    };
    queueMicrotask(() => {
      if (records === "empty") request.onupgradeneeded({ oldVersion: 0 });
      else if (records === "unavailable") request.onerror();
      else request.onsuccess();
    });
    return request;
  });

  runInNewContext(script, {
    document: { getElementById: () => message },
    location: { replace },
    indexedDB: { open },
    navigator: { onLine: !offline },
    setTimeout,
    clearTimeout,
  });
  await new Promise(resolve => setImmediate(resolve));
  return { message, replace, open, transaction, close };
}

describe("legacy F&B shortcut", () => {
  it("serves a non-cacheable document with an explicit legacy fallback and signed inline script", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain('href="/pos/fnb?fnb_legacy=1"');
    const script = html.match(/<script>([\s\S]+)<\/script>/)![1];
    const hash = createHash("sha256").update(script).digest("base64");
    expect(response.headers.get("content-security-policy")).toContain(`'sha256-${hash}'`);
  });

  it("switches a fresh browser without creating a POS database", async () => {
    const gate = await openWith("empty");
    expect(gate.open).toHaveBeenCalledWith("onebiz-fnb-offline");
    expect(gate.open.mock.results[0].value.transaction.abort).toHaveBeenCalledOnce();
    expect(gate.transaction).not.toHaveBeenCalled();
    expect(gate.replace).toHaveBeenCalledExactlyOnceWith("https://fnb.onebiz.com.vn/");
  });

  it("switches when remaining records are synced, confirmed, or Retail-only", async () => {
    const gate = await openWith({
      meta: [{ key: "fnb-tabs:branch", value: { activeTabId: "old", savedAt: Date.now() - 25 * 60 * 60 * 1000, tabs: [{ id: "old", lines: [], sentLines: [{ id: "line" }], kitchenOrderId: "server-id" }] } },
        { key: "fnb-kitchen-supplement:sent", value: { confirmed: true } }],
      sync_queue: [{ action: "posCheckout", status: "pending" }, { action: "fnbPayment", status: "completed" }],
      pending_orders: [{ orderType: "delivery", status: "synced" }],
    });
    expect(gate.transaction).toHaveBeenCalledExactlyOnceWith(["meta", "sync_queue", "pending_orders"], "readonly");
    expect(gate.close).toHaveBeenCalledOnce();
    expect(gate.replace).toHaveBeenCalledOnce();
  });

  it.each([
    { meta: [{ key: "fnb-tabs:other-branch", value: { tabs: [{ lines: [{ id: "unsent" }] }] } }] },
    { meta: [{ key: "fnb-tabs:branch", value: { tabs: [{ kitchenOrderId: "sent", orderNoteDraftBase: "" }] } }] },
    { meta: [{ key: "fnb-tabs:branch", value: { activeTabId: "active", savedAt: Date.now(), tabs: [{ id: "active", kitchenOrderId: "sent", sentLines: [{}] }] } }] },
    { meta: [{ key: "fnb-kitchen-request:uncertain", value: { payload: "{}" } }] },
    { meta: [{ key: "fnb-kitchen-supplement:uncertain", value: { confirmed: false } }] },
    { sync_queue: [{ action: "addItems", status: "failed" }] },
    { pending_orders: [{ status: "pending_payment", orderType: "dine_in" }] },
  ])("keeps a path to the original POS if local work remains (%j)", async records => {
    const gate = await openWith(records);
    expect(gate.replace).not.toHaveBeenCalled();
    expect(gate.message.textContent).toContain("Mở POS cũ");
  });

  it.each([false, true])("stays on the original origin when storage is unavailable or offline (%s)", async offline => {
    const gate = await openWith("unavailable", offline);
    expect(gate.replace).not.toHaveBeenCalled();
    expect(gate.message.textContent).toContain("Chưa kiểm tra được bill");
  });
});
