import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/services/supabase/kitchen-orders", () => ({ getKitchenOrderById: mock.get }));
import { useFnbTabReconciliation } from "@/lib/hooks/use-fnb-tab-reconciliation";
import type { KitchenOrder } from "@/lib/types/fnb";
const paid = { id: "ko", branchId: "xtb", invoiceId: "invoice", mergedIntoId: null, status: "served" } as KitchenOrder;
const params = () => ({ tabId: "tab", orderId: "ko", branchId: "xtb", orders: [], updatedAt: new Date(), blocked: false, onClosed: vi.fn() });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("restored and cross-device POS tabs", () => {
  it("closes only after the server confirms the missing open order is settled", async () => {
    mock.get.mockResolvedValue(paid); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(input.onClosed).toHaveBeenCalledWith(paid, "tab"));
  });
  it("preserves local data when the verification read fails", async () => {
    mock.get.mockRejectedValue(new Error("offline")); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it("does not confuse absence from a list with payment", async () => {
    mock.get.mockResolvedValue({ ...paid, invoiceId: null }); const input = params();
    renderHook(() => useFnbTabReconciliation(input));
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it("ignores a late response after changing tabs", async () => {
    let resolve!: (order: KitchenOrder) => void;
    mock.get.mockReturnValue(new Promise<KitchenOrder>(done => { resolve = done; })); const input = params();
    const hook = renderHook(props => useFnbTabReconciliation(props), { initialProps: input });
    hook.rerender({ ...input, tabId: "new", orderId: "new-order", blocked: true });
    resolve(paid); await Promise.resolve();
    expect(input.onClosed).not.toHaveBeenCalled();
  });
  it("does not interfere with a send/payment in progress", () => {
    const input = params(); renderHook(() => useFnbTabReconciliation({ ...input, blocked: true }));
    expect(mock.get).not.toHaveBeenCalled();
  });
});
