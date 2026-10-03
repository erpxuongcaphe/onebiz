import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncQueueEntry } from "@/lib/offline/db";

const state = vi.hoisted(() => ({ queue: new Map<number, SyncQueueEntry>(), deleted: [] as number[] }));
vi.mock("@/lib/offline/db", () => ({ getDb: async () => ({
  count: async () => state.queue.size,
  add: async (_store: string, value: SyncQueueEntry) => {
    const id = Math.max(0, ...state.queue.keys()) + 1;
    state.queue.set(id, { ...value, id });
    return id;
  },
  transaction: () => ({ done: Promise.resolve(), objectStore: () => ({
    index: () => ({
      getAllKeys: async (status: string) => [...state.queue.values()].filter(e => e.status === status).map(e => e.id!),
      getAll: async (status: string) => [...state.queue.values()].filter(e => e.status === status),
    }),
    delete: async (id: number) => { state.deleted.push(id); state.queue.delete(id); },
  }) }),
}) }));
vi.mock("@/lib/services/supabase/fnb-checkout", () => ({ sendToKitchen: vi.fn(), fnbPayment: vi.fn(), addItemsToExistingOrder: vi.fn() }));
vi.mock("@/lib/services/supabase/pos-checkout", () => ({ posCheckout: vi.fn() }));
import { enqueue } from "@/lib/offline/sync-manager";

function seed(count: number, status: SyncQueueEntry["status"], action: SyncQueueEntry["action"] = "fnbPayment") {
  for (let id = 1; id <= count; id++) state.queue.set(id, {
    id, status, action, payload: { kitchenOrderId: `order-${id}` }, localId: `local-${id}`,
    attempts: 10, lastAttempt: null, error: "Needs review", createdAt: "2026-10-03T10:00:00Z",
  });
}
const next = { action: "sendToKitchen" as const, payload: { idempotencyKey: "new-order" }, localId: "local-new", createdAt: "2026-10-03T11:00:00Z" };

describe("offline queue retention", () => {
  beforeEach(() => { state.queue.clear(); state.deleted.length = 0; });
  it.each(["fnbPayment", "posCheckout"] as const)("never evicts failed %s entries to make room", async action => {
    seed(500, "failed", action);
    const before = structuredClone(state.queue.get(1));
    await enqueue(next);
    expect(state.deleted).toEqual([]);
    expect(state.queue.size).toBe(501);
    expect(state.queue.get(1)).toEqual(before);
  });
  it("only prunes completed entries and preserves failed, pending and syncing data", async () => {
    seed(502, "failed");
    state.queue.set(500, { ...state.queue.get(500)!, status: "pending" });
    state.queue.set(501, { ...state.queue.get(501)!, status: "syncing" });
    state.queue.set(502, { ...state.queue.get(502)!, status: "completed" });
    await enqueue(next);
    expect(state.deleted).toEqual([502]);
    expect(state.queue.get(1)?.status).toBe("failed");
    expect(state.queue.get(500)?.status).toBe("pending");
    expect(state.queue.get(501)?.status).toBe("syncing");
  });
});
