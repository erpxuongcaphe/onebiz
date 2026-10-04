import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendToKitchenInput } from "@/lib/services/supabase/fnb-checkout";

const state = vi.hoisted(() => ({ meta: new Map<string, unknown>(), add: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({
  getMeta: async (key: string) => state.meta.get(key),
  setMeta: async (key: string, value: unknown) => {
    state.write(key, value);
    state.meta.set(key, structuredClone(value));
  },
}));
vi.mock("@/lib/services/supabase/fnb-checkout", () => ({ addItemsToExistingOrder: state.add, sendToKitchen: vi.fn() }));
import { sendRecoverableKitchenSupplement, type KitchenSupplementIdentity } from "@/lib/offline/kitchen-request";

const identity: KitchenSupplementIdentity = { tenantId: "tenant", branchId: "xtb", createdBy: "cashier", tabId: "cart", lineIds: ["line-1"] };
const items: SendToKitchenInput["items"] = [{ productId: "coffee", productName: "Coffee", quantity: 1, unitPrice: 30000 }];

describe("F&B supplement response recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); state.meta.clear(); state.add.mockReset(); });

  it("reuses the persisted batch after simulated commit, response loss and module reload", async () => {
    const batches = new Set<string>();
    state.add.mockImplementationOnce(async (_order, _items, options) => {
      expect(state.meta.size).toBe(1);
      batches.add(options.batchId);
      throw new Error("response lost");
    }).mockImplementation(async (_order, _items, options) => { batches.add(options.batchId); });
    await expect(sendRecoverableKitchenSupplement("order", items, identity, true)).rejects.toThrow("Chưa xác nhận");
    vi.resetModules();
    const reloaded = await import("@/lib/offline/kitchen-request");
    expect(await reloaded.sendRecoverableKitchenSupplement("order", structuredClone(items), structuredClone(identity), true)).toBe(true);
    expect(batches.size).toBe(1);
    expect(state.add.mock.calls[0][2]).toEqual(state.add.mock.calls[1][2]);
    expect(await reloaded.sendRecoverableKitchenSupplement("order", items, identity, false)).toBe(true);
    expect(state.add).toHaveBeenCalledTimes(2);
  });

  it("gives a genuinely new line a new batch even when the same drink and quantity are ordered again", async () => {
    state.add.mockResolvedValue(undefined);
    await sendRecoverableKitchenSupplement("order", items, identity, true);
    await sendRecoverableKitchenSupplement("order", items, { ...identity, lineIds: ["line-2"] }, true);
    expect(state.add).toHaveBeenCalledTimes(2);
    expect(state.add.mock.calls[0][2].batchId).not.toBe(state.add.mock.calls[1][2].batchId);
    expect(state.meta.size).toBe(1);
  });

  it("blocks changed quantity, new lines, changed cashier and offline fallback while a send is uncertain", async () => {
    state.add.mockRejectedValue(new Error("timeout"));
    await expect(sendRecoverableKitchenSupplement("order", items, identity, true)).rejects.toThrow("Chưa xác nhận");
    for (const next of [{ ...identity, createdBy: "other" }, { ...identity, lineIds: ["line-2"] }]) {
      await expect(sendRecoverableKitchenSupplement("order", items, next, true)).rejects.toThrow("đã thay đổi");
    }
    await expect(sendRecoverableKitchenSupplement("order", [{ ...items[0], quantity: 2 }], identity, true)).rejects.toThrow("đã thay đổi");
    await expect(sendRecoverableKitchenSupplement("order", items, identity, false)).rejects.toThrow("Kết nối mạng");
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  it("permits correction after first SQL rejection but never clears an earlier uncertain request on retry rejection", async () => {
    const rejected = Object.assign(new Error("PRICE_CHANGED"), { kitchenRequestRejected: true });
    state.add.mockRejectedValueOnce(rejected).mockResolvedValueOnce(undefined);
    await expect(sendRecoverableKitchenSupplement("order", items, identity, true)).rejects.toBe(rejected);
    expect(await sendRecoverableKitchenSupplement("order", [{ ...items[0], unitPrice: 32000 }], identity, true)).toBe(true);
    state.meta.clear();
    state.add.mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(rejected);
    await expect(sendRecoverableKitchenSupplement("order", items, identity, true)).rejects.toThrow("Chưa xác nhận");
    await expect(sendRecoverableKitchenSupplement("order", items, identity, true)).rejects.toThrow("Chưa xác nhận");
    await expect(sendRecoverableKitchenSupplement("order", items, { ...identity, lineIds: ["new"] }, true)).rejects.toThrow("đã thay đổi");
  });

  it("does not call transport if persistence fails and preserves a fresh offline queue path", async () => {
    state.write.mockImplementationOnce(() => { throw new Error("disk full"); });
    await expect(sendRecoverableKitchenSupplement("order", items, identity, true)).rejects.toThrow("disk full");
    expect(state.add).not.toHaveBeenCalled();
    expect(await sendRecoverableKitchenSupplement("order", items, identity, false)).toBe(false);
  });

  it("isolates order, branch, tenant and tab request slots", async () => {
    state.add.mockResolvedValue(undefined);
    for (const next of [identity, { ...identity, branchId: "other" }, { ...identity, tenantId: "other" }, { ...identity, tabId: "other" }]) {
      await sendRecoverableKitchenSupplement("order", items, next, true);
    }
    await sendRecoverableKitchenSupplement("other-order", items, identity, true);
    expect(state.meta.size).toBe(5);
    expect(state.add).toHaveBeenCalledTimes(5);
  });
});
