import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOrder, SyncQueueEntry } from "@/lib/offline/db";

const state = vi.hoisted(() => ({
  queue: new Map<number, SyncQueueEntry>(),
  orders: new Map<string, PendingOrder>(),
  send: vi.fn(), payment: vi.fn(), add: vi.fn(), retail: vi.fn(),
  checkpointFailures: 0,
  readFailures: 0,
  writes: [] as string[],
}));
vi.mock("@/lib/offline/db", () => ({ getDb: async () => ({
  get: async (_store: string, id: string) => state.orders.get(id),
  put: async (store: string, value: SyncQueueEntry | PendingOrder) => {
    state.writes.push(`${store}:${value.status}`);
    if (store === "pending_orders" && state.checkpointFailures > 0) {
      state.checkpointFailures--;
      throw new Error("checkpoint write failed");
    }
    if (store === "sync_queue") state.queue.set((value as SyncQueueEntry).id!, value as SyncQueueEntry);
    else state.orders.set((value as PendingOrder).localId, value as PendingOrder);
  },
  transaction: () => ({ objectStore: () => ({ index: () => ({
    getAll: async (status: string) => {
      if (state.readFailures > 0) {
        state.readFailures--;
        throw new Error("queue read failed");
      }
      return [...state.queue.values()].filter(entry => entry.status === status);
    },
  }) }) }),
}) }));
vi.mock("@/lib/services/supabase/fnb-checkout", () => ({
  sendToKitchen: state.send, fnbPayment: state.payment, addItemsToExistingOrder: state.add,
}));
vi.mock("@/lib/services/supabase/pos-checkout", () => ({ posCheckout: state.retail }));
import { replayQueue } from "@/lib/offline/sync-manager";

function enqueue(id: number, action: SyncQueueEntry["action"], payload: unknown) {
  state.queue.set(id, { id, action, payload, localId: "local_test", status: "pending",
    attempts: 0, lastAttempt: null, error: null, createdAt: new Date().toISOString() });
}
const paymentInput = { kitchenOrderId: "local_test", tenantId: "tenant", branchId: "xtb", total: 30000 };

describe("F&B offline order dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.queue.clear(); state.orders.clear();
    state.checkpointFailures = 0; state.readFailures = 0; state.writes.length = 0;
    state.orders.set("local_test", { localId: "local_test", tenantId: "tenant", branchId: "xtb",
      localOrderNumber: "OFF-1", orderType: "takeaway", items: [{ productId: "coffee" }],
      status: "pending_payment", paymentData: paymentInput, createdAt: "now", updatedAt: "now" });
    state.send.mockResolvedValue({ kitchenOrderId: "server-order", orderNumber: "KB-UAT" });
    state.payment.mockResolvedValue({ invoiceId: "invoice", invoiceCode: "HD-UAT" });
    state.add.mockResolvedValue(undefined);
  });
  it("shares an in-flight replay instead of sending the same offline order twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    state.send.mockImplementation(async () => {
      await gate;
      return { kitchenOrderId: "server-order", orderNumber: "KB-UAT" };
    });
    enqueue(1, "sendToKitchen", { idempotencyKey: "stable-order" });
    const first = replayQueue();
    const second = replayQueue();
    release();
    const [firstResults, secondResults] = await Promise.all([first, second]);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(firstResults).toEqual(secondResults);
    expect(state.queue.get(1)?.status).toBe("completed");
    await replayQueue();
    expect(state.send).toHaveBeenCalledTimes(1);
    enqueue(2, "sendToKitchen", { idempotencyKey: "next-order" });
    await replayQueue();
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.send).toHaveBeenLastCalledWith({ idempotencyKey: "next-order" });
  });
  it("releases the shared replay after an IndexedDB failure without discarding pending work", async () => {
    enqueue(1, "sendToKitchen", { idempotencyKey: "stable-order" });
    state.readFailures = 1;
    const outcomes = await Promise.allSettled([replayQueue(), replayQueue()]);
    expect(outcomes.map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.queue.get(1)?.status).toBe("pending");
    await replayQueue();
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.queue.get(1)?.status).toBe("completed");
  });
  it("maps queued payment to the server order without rewriting the saved payload", async () => {
    enqueue(1, "sendToKitchen", { idempotencyKey: "local_test" });
    enqueue(2, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.payment).toHaveBeenCalledWith({ ...paymentInput, kitchenOrderId: "server-order" });
    expect((state.queue.get(2)!.payload as typeof paymentInput).kitchenOrderId).toBe("local_test");
    expect(state.orders.get("local_test")!.serverInvoiceId).toBe("invoice");
    expect(state.orders.get("local_test")!.items).toEqual([{ productId: "coffee" }]);
  });
  it.each(["sendToKitchen", "fnbPayment"] as const)("persists %s linkage before completing its queue entry", async action => {
    if (action === "fnbPayment") {
      state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "server-order" });
    }
    enqueue(1, action, action === "sendToKitchen" ? { idempotencyKey: "stable" } : paymentInput);
    await replayQueue();
    const completed = state.writes.indexOf("sync_queue:completed");
    const checkpoint = state.writes.findIndex(write => write.startsWith("pending_orders:"));
    expect(checkpoint).toBeGreaterThanOrEqual(0);
    expect(checkpoint).toBeLessThan(completed);
  });
  it("never exposes a completed kitchen send when saving the local linkage fails", async () => {
    state.checkpointFailures = 1;
    enqueue(1, "sendToKitchen", { idempotencyKey: "stable" });
    enqueue(2, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.writes).not.toContain("sync_queue:completed");
    expect(state.queue.get(1)).toMatchObject({ status: "pending", attempts: 1 });
    expect(state.payment).not.toHaveBeenCalled();
    await replayQueue();
    expect(state.send.mock.calls).toEqual([[{ idempotencyKey: "stable" }], [{ idempotencyKey: "stable" }]]);
    expect(state.orders.get("local_test")).toMatchObject({ serverOrderId: "server-order", serverInvoiceId: "invoice" });
  });
  it("holds payment after a lost supplement response and retries the same batch before payment", async () => {
    state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "server-order" });
    const supplement = { kitchenOrderId: "local_test", items: [{ productId: "coffee" }], batchId: "stable-batch" };
    state.add.mockRejectedValueOnce(new Error("response lost"));
    enqueue(1, "addItems", supplement);
    enqueue(2, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.payment).not.toHaveBeenCalled();
    expect(state.queue.get(2)).toMatchObject({ status: "pending", attempts: 0, payload: paymentInput });
    await replayQueue();
    expect(state.add).toHaveBeenCalledTimes(2);
    for (const args of state.add.mock.calls) {
      expect(args).toEqual(["server-order", supplement.items, { batchId: "stable-batch" }]);
    }
    expect(state.payment).toHaveBeenCalledTimes(1);
    expect(state.queue.get(2)?.status).toBe("completed");
    await replayQueue();
    expect(state.payment).toHaveBeenCalledTimes(1);
  });
  it("replays offline send, supplement and payment in order after a lost send response", async () => {
    const kitchen = { idempotencyKey: "stable-order" };
    const supplement = { kitchenOrderId: "local_test", items: [], batchId: "stable-batch" };
    state.send.mockRejectedValueOnce(new Error("response lost"));
    enqueue(1, "sendToKitchen", kitchen);
    enqueue(2, "addItems", supplement);
    enqueue(3, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.payment).not.toHaveBeenCalled();
    expect(state.queue.get(2)).toMatchObject({ status: "pending", attempts: 0, payload: supplement });
    expect(state.queue.get(3)).toMatchObject({ status: "pending", attempts: 0, payload: paymentInput });
    await replayQueue();
    expect(state.send.mock.calls).toEqual([[kitchen], [kitchen]]);
    expect(state.add).toHaveBeenCalledWith("server-order", [], { batchId: "stable-batch" });
    expect(state.payment).toHaveBeenCalledWith({ ...paymentInput, kitchenOrderId: "server-order" });
    expect(state.add.mock.invocationCallOrder[0]).toBeLessThan(state.payment.mock.invocationCallOrder[0]);
    expect([...state.queue.values()].every(entry => entry.status === "completed")).toBe(true);
    expect(state.orders.get("local_test")).toMatchObject({ serverOrderId: "server-order", serverInvoiceId: "invoice" });
  });
  it("holds the next supplement behind an unconfirmed batch even for an existing server order", async () => {
    enqueue(1, "addItems", { kitchenOrderId: "server-order", items: [], batchId: "first" });
    state.queue.set(1, { ...state.queue.get(1)!, status: "failed" });
    enqueue(2, "addItems", { kitchenOrderId: "server-order", items: [], batchId: "second" });
    await replayQueue();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.queue.get(2)).toMatchObject({ status: "pending", attempts: 0 });
  });
  it.each(["failed", "syncing"] as const)("holds dependent payment behind a %s supplement, but not Retail or another bill", async status => {
    state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "server-order" });
    enqueue(1, "addItems", { kitchenOrderId: "local_test", items: [], batchId: "stable" });
    state.queue.set(1, { ...state.queue.get(1)!, status, lastAttempt: new Date().toISOString() });
    enqueue(2, "fnbPayment", paymentInput);
    enqueue(3, "posCheckout", { idempotencyKey: "retail" });
    enqueue(4, "fnbPayment", { ...paymentInput, kitchenOrderId: "other-server" });
    state.queue.set(4, { ...state.queue.get(4)!, localId: "local_other" });
    state.retail.mockResolvedValue({ invoiceId: "retail", invoiceCode: "HD-R" });
    await replayQueue();
    expect(state.payment).toHaveBeenCalledTimes(1);
    expect(state.payment).toHaveBeenCalledWith({ ...paymentInput, kitchenOrderId: "other-server" });
    expect(state.retail).toHaveBeenCalledTimes(1);
    expect(state.queue.get(2)).toMatchObject({ status: "pending", attempts: 0 });
  });
  it("defers unresolved payment without spending retries or losing the order", async () => {
    enqueue(1, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.payment).not.toHaveBeenCalled();
    expect(state.queue.get(1)).toMatchObject({ status: "pending", attempts: 0 });
    expect(state.orders.get("local_test")!.status).toBe("pending_payment");
  });
  it("maps add-items and preserves pending payment after kitchen sync", async () => {
    enqueue(1, "sendToKitchen", { idempotencyKey: "local_test" });
    enqueue(2, "addItems", { kitchenOrderId: "local_test", items: [], batchId: "batch-fixed" });
    await replayQueue();
    expect(state.add).toHaveBeenCalledWith("server-order", [], { batchId: "batch-fixed" });
    expect(state.orders.get("local_test")!.status).toBe("pending_payment");
  });
  it("never reuses an order mapping from another branch", async () => {
    state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "other-order", branchId: "other" });
    enqueue(1, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.payment).not.toHaveBeenCalled();
  });
  it("uses a persisted mapping after restart and does not replay completed entries", async () => {
    state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "persisted-order" });
    enqueue(1, "fnbPayment", paymentInput);
    await replayQueue();
    await replayQueue();
    expect(state.payment).toHaveBeenCalledTimes(1);
    expect(state.payment).toHaveBeenCalledWith({ ...paymentInput, kitchenOrderId: "persisted-order" });
  });
  it("leaves server order IDs and Retail payloads unchanged", async () => {
    const serverPayment = { ...paymentInput, kitchenOrderId: "server-existing" };
    const retailPayload = { idempotencyKey: "retail-stable" };
    enqueue(1, "fnbPayment", serverPayment);
    enqueue(2, "posCheckout", retailPayload);
    state.retail.mockResolvedValue({ invoiceId: "retail-invoice", invoiceCode: "HD-R" });
    await replayQueue();
    expect(state.payment).toHaveBeenCalledWith(serverPayment);
    expect(state.retail).toHaveBeenCalledWith(retailPayload);
  });
  it("does not accept a mapped order from another tenant", async () => {
    state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "other-order", tenantId: "other" });
    enqueue(1, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.payment).not.toHaveBeenCalled();
  });
  it("retries a timeout against the same server order and retains local payment data", async () => {
    state.orders.set("local_test", { ...state.orders.get("local_test")!, serverOrderId: "persisted-order" });
    state.payment.mockRejectedValueOnce(new Error("network timeout"));
    enqueue(1, "fnbPayment", paymentInput);
    await replayQueue();
    expect(state.queue.get(1)).toMatchObject({ status: "pending", attempts: 1, payload: paymentInput });
    expect(state.orders.get("local_test")).toMatchObject({ status: "pending_payment", paymentData: paymentInput });
    await replayQueue();
    expect(state.payment).toHaveBeenCalledTimes(2);
    expect(state.queue.get(1)).toMatchObject({ status: "completed", error: null, attempts: 1, payload: paymentInput });
    for (const [input] of state.payment.mock.calls) {
      expect(input).toEqual({ ...paymentInput, kitchenOrderId: "persisted-order" });
    }
  });
});
