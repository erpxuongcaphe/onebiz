import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOrder, SyncQueueEntry } from "@/lib/offline/db";

const state = vi.hoisted(() => ({
  queue: new Map<number, SyncQueueEntry>(),
  orders: new Map<string, PendingOrder>(),
  send: vi.fn(), payment: vi.fn(), add: vi.fn(), retail: vi.fn(),
}));
vi.mock("@/lib/offline/db", () => ({ getDb: async () => ({
  get: async (_store: string, id: string) => state.orders.get(id),
  put: async (store: string, value: SyncQueueEntry | PendingOrder) => {
    if (store === "sync_queue") state.queue.set((value as SyncQueueEntry).id!, value as SyncQueueEntry);
    else state.orders.set((value as PendingOrder).localId, value as PendingOrder);
  },
  transaction: () => ({ objectStore: () => ({ index: () => ({
    getAll: async (status: string) => [...state.queue.values()].filter(entry => entry.status === status),
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
    state.orders.set("local_test", { localId: "local_test", tenantId: "tenant", branchId: "xtb",
      localOrderNumber: "OFF-1", orderType: "takeaway", items: [{ productId: "coffee" }],
      status: "pending_payment", paymentData: paymentInput, createdAt: "now", updatedAt: "now" });
    state.send.mockResolvedValue({ kitchenOrderId: "server-order", orderNumber: "KB-UAT" });
    state.payment.mockResolvedValue({ invoiceId: "invoice", invoiceCode: "HD-UAT" });
    state.add.mockResolvedValue(undefined);
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
    for (const [input] of state.payment.mock.calls) {
      expect(input).toEqual({ ...paymentInput, kitchenOrderId: "persisted-order" });
    }
  });
});
