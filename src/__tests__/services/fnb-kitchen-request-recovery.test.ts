import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendToKitchenInput } from "@/lib/services/supabase/fnb-checkout";

const state = vi.hoisted(() => ({ meta: new Map<string, unknown>(), send: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({
  getMeta: async (key: string) => state.meta.get(key),
  setMeta: async (key: string, value: unknown) => {
    state.write(key, value);
    state.meta.set(key, structuredClone(value));
  },
}));
vi.mock("@/lib/services/supabase/fnb-checkout", () => ({ sendToKitchen: state.send }));
import { sendRecoverableKitchenRequest } from "@/lib/offline/kitchen-request";

const input: SendToKitchenInput = {
  tenantId: "tenant", branchId: "xtb", createdBy: "cashier", orderType: "takeaway",
  idempotencyKey: "fnb-tab:cart-1",
  items: [{ productId: "coffee", productName: "Coffee", quantity: 1, unitPrice: 30000 }],
};
const result = { kitchenOrderId: "order-1", orderNumber: "KB-UAT" };

describe("new F&B kitchen request recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); state.meta.clear(); state.send.mockReset(); });

  it("persists before sending and retries the same request after a lost committed response and module reload", async () => {
    const orders = new Map<string, typeof result>();
    state.send.mockImplementationOnce(async (request: SendToKitchenInput) => {
      expect(state.meta.size).toBe(1);
      orders.set(request.idempotencyKey!, result);
      throw new Error("response lost after commit");
    }).mockImplementation(async (request: SendToKitchenInput) => orders.get(request.idempotencyKey!));
    await expect(sendRecoverableKitchenRequest(input, true)).rejects.toThrow("Chưa xác nhận");
    vi.resetModules();
    const reloaded = await import("@/lib/offline/kitchen-request");
    expect(await reloaded.sendRecoverableKitchenRequest(structuredClone(input), true)).toEqual(result);
    expect(orders.size).toBe(1);
    expect(state.send).toHaveBeenNthCalledWith(1, input);
    expect(state.send).toHaveBeenNthCalledWith(2, input);
    expect(await reloaded.sendRecoverableKitchenRequest(input, false)).toEqual(result);
    expect(state.send).toHaveBeenCalledTimes(2);
  });

  it("does not resend changed items or a different cashier after an uncertain response", async () => {
    state.send.mockRejectedValue(new Error("timeout"));
    await expect(sendRecoverableKitchenRequest(input, true)).rejects.toThrow("Chưa xác nhận");
    await expect(sendRecoverableKitchenRequest({ ...input, items: [{ ...input.items[0], quantity: 2 }] }, true)).rejects.toThrow("Giỏ đã thay đổi");
    await expect(sendRecoverableKitchenRequest({ ...input, createdBy: "other" }, true)).rejects.toThrow("Giỏ đã thay đổi");
    await expect(sendRecoverableKitchenRequest(input, false)).rejects.toThrow("Kết nối mạng");
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("allows correction after an explicit first SQL rejection but not after an uncertain commit", async () => {
    const rejected = Object.assign(new Error("PRICE_CHANGED"), { kitchenRequestRejected: true });
    state.send.mockRejectedValueOnce(rejected).mockResolvedValueOnce(result);
    await expect(sendRecoverableKitchenRequest(input, true)).rejects.toBe(rejected);
    expect(await sendRecoverableKitchenRequest({ ...input, note: "corrected" }, true)).toEqual(result);
    state.meta.clear();
    state.send.mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(rejected);
    await expect(sendRecoverableKitchenRequest(input, true)).rejects.toThrow("Chưa xác nhận");
    await expect(sendRecoverableKitchenRequest(input, true)).rejects.toThrow("Chưa xác nhận");
    await expect(sendRecoverableKitchenRequest({ ...input, note: "changed" }, true)).rejects.toThrow("Giỏ đã thay đổi");
  });

  it("never sends when durable storage fails and leaves legacy/offline calls unchanged", async () => {
    state.write.mockImplementationOnce(() => { throw new Error("disk full"); });
    await expect(sendRecoverableKitchenRequest(input, true)).rejects.toThrow("disk full");
    expect(state.send).not.toHaveBeenCalled();
    expect(await sendRecoverableKitchenRequest({ ...input, idempotencyKey: undefined }, true)).toBeNull();
    expect(await sendRecoverableKitchenRequest(input, false)).toBeNull();
  });

  it("separates branches, tenants and different carts", async () => {
    state.send.mockResolvedValue(result);
    for (const request of [input, { ...input, branchId: "other" }, { ...input, tenantId: "other" }, { ...input, idempotencyKey: "fnb-tab:cart-2" }]) {
      await sendRecoverableKitchenRequest(request, true);
    }
    expect(state.meta.size).toBe(4);
    expect(state.send).toHaveBeenCalledTimes(4);
  });
});
