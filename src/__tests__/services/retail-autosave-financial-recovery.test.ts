import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/services/supabase", () => ({ saveDraftOrder: api.save, deleteDraftOrder: api.remove }));
vi.mock("@/lib/hooks/use-unsaved-work", () => ({ useUnsavedWork: vi.fn() }));
import { useAutoSaveDraft, loadLocalCart } from "@/app/pos/hooks/use-auto-save-draft";
import { usePosState } from "@/app/pos/hooks/use-pos-state";
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.save.mockReset();
  api.save.mockResolvedValue({ invoiceId: "draft", revision: 1 });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => vi.useRealTimers());
function props() {
  return { sessionId: "session", enabled: true,
    ctx: { tenantId: "t", branchId: "b", userId: "u" },
    snapshot: { lines: [{ lineId: "line", productId: "sku", productCode: "SKU", productName: "SKU", unit: "kg",
      quantity: 2, availableStock: 5, unitPrice: 12000, vatRate: 0, discount: {mode: "amount" as const, value: 0} }],
      customer: null, orderDiscount: { mode: "amount" as const, value: 0 }, paymentMethod: "cash" as const,
      subtotal: 24000, total: 24000, orderDiscountAmount: 0, lineDiscountTotal: 0,
      shippingFee: 0, orderVatRate: 0, note: "edited", computeLineTotal: () => 24000,
    },
  };
}
describe("Retail autosave preserves financial edits", () => {
  it("resaves when only shipping or VAT changes and uses the prior server revision", async () => {
    const initial = props();
    const hook = renderHook((input) => useAutoSaveDraft(input), { initialProps: initial });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(api.save).toHaveBeenCalledTimes(1);
    hook.rerender({ ...initial, snapshot: { ...initial.snapshot, shippingFee: 10000, total: 34000 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1][0].shippingFee).toBe(10000);
    expect(api.save.mock.calls[1][1].expectedRevision).toBe(1);
    hook.rerender({ ...initial, snapshot: { ...initial.snapshot, orderVatRate: 8, total: 25920 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(api.save).toHaveBeenCalledTimes(3);
    expect(api.save.mock.calls[2][0].orderVatRate).toBe(8);
    hook.unmount();
  });
  it("backs up draft linkage, payments and delivery before the server debounce", () => {
    const state = renderHook(() => usePosState());
    const initial = props();
    const full = { ...state.result.current.getSnapshot(), lines: initial.snapshot.lines,
      loadedDraftId: "child-sale", loadedDraftRevision: 17, loadedDraftSource: "pos", paid: 15000,
      deliveryInfo: { ...state.result.current.deliveryInfo, address: "Buu Hoa" } };
    const hook = renderHook(() => useAutoSaveDraft({ ...initial, localSnapshot: full }));
    expect(api.save).not.toHaveBeenCalled();
    expect(loadLocalCart("t", "b")?.fullSnapshot).toEqual(full);
    hook.unmount(); state.unmount();
  });
});
