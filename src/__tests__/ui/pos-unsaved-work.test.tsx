import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import { useAutoSaveDraft } from "@/app/pos/hooks/use-auto-save-draft";
import { useFnbPosState } from "@/app/pos/fnb/hooks/use-fnb-pos-state";

const api = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/services/supabase", () => ({ saveDraftOrder: api.save, deleteDraftOrder: api.remove }));
vi.mock("@/app/pos/fnb/hooks/persist-tabs", () => ({ loadPersistedTabs: vi.fn().mockResolvedValue(null), savePersistedTabs: vi.fn().mockResolvedValue(undefined), clearPersistedTabs: vi.fn().mockResolvedValue(undefined) }));
type Snapshot = Parameters<typeof useAutoSaveDraft>[0]["snapshot"];
const cart = (quantity = 1): Snapshot => ({
  lines: [{ lineId:"line", productId:"product", productName:"Cà phê", productCode:"SKU", quantity, unitPrice:20000, unit:"Chai", vatRate:0, discount:{mode:"amount",value:0}, availableStock:10 }],
  customer:null,orderDiscount:{mode:"amount",value:0},paymentMethod:"cash",subtotal:quantity*20000,total:quantity*20000,orderDiscountAmount:0,lineDiscountTotal:0,shippingFee:0,orderVatRate:0,computeLineTotal:()=>quantity*20000,
});
beforeEach(() => { vi.useFakeTimers(); api.save.mockReset().mockResolvedValue({invoiceId:"draft",revision:1}); api.remove.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("POS navigation reads existing save state", () => {
  it("warns before acknowledgement, clears after saving and tracks inactive sessions independently", async () => {
    const ctx={tenantId:"tenant",branchId:"branch",userId:"user"};
    const view=renderHook(({snapshot})=>useAutoSaveDraft({ctx,sessionId:"one",snapshot,enabled:true}),{initialProps:{snapshot:cart()}});
    expect(hasUnsavedWork()).toBe(true);
    await act(()=>vi.advanceTimersByTimeAsync(500));
    expect(api.save).toHaveBeenCalledTimes(1); expect(hasUnsavedWork()).toBe(false);
    expect(view.result.current("one",cart())).toBe(false); expect(view.result.current("two",cart())).toBe(true);
    view.rerender({snapshot:cart(2)}); expect(hasUnsavedWork()).toBe(true);
    await act(()=>vi.advanceTimersByTimeAsync(500)); expect(hasUnsavedWork()).toBe(false);
    expect(api.save).toHaveBeenCalledTimes(2);
  });
  it("keeps failed saves protected and never adds an extra request for reading the guard", async () => {
    vi.spyOn(console,"warn").mockImplementation(()=>{}); api.save.mockRejectedValue(new Error("offline"));
    renderHook(()=>useAutoSaveDraft({ctx:{tenantId:"tenant",branchId:"branch",userId:"user"},sessionId:"one",snapshot:cart(),enabled:true}));
    await act(()=>vi.advanceTimersByTimeAsync(500)); expect(hasUnsavedWork()).toBe(true);
    hasUnsavedWork(); hasUnsavedWork(); expect(api.save).toHaveBeenCalledTimes(1);
  });
  it("treats pending FnB dishes as work but not acknowledged kitchen lines", () => {
    const view=renderHook(()=>useFnbPosState()); expect(hasUnsavedWork()).toBe(false);
    act(()=>view.result.current.addLine({productId:"coffee",productName:"Cà phê",unitPrice:20000,quantity:1,toppings:[]}));
    expect(hasUnsavedWork()).toBe(true);
    act(()=>view.result.current.markActiveLinesSent()); expect(hasUnsavedWork()).toBe(false);
    expect(view.result.current.allLines.length).toBe(1); expect(api.save).not.toHaveBeenCalled();
  });
});
