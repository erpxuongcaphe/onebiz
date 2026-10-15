import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/services/supabase/base", () => ({ getClient: vi.fn(), handleError: vi.fn() }));
import { valueStockQuantity, type StockValuation } from "@/lib/services/supabase/stock-valuation";

const coldBrew: StockValuation = { branchId: "tuba", productId: "cold", quantity: 2885.925, value: 116627.4634, unitCost: 40.4125067, complete: true };
describe("stock valuation authority", () => {
  it("uses the exact journal balance rather than multiplying a stale per-batch product price", () => {
    expect(valueStockQuantity(2885.925, coldBrew)).toBeCloseTo(116627.4634, 4);
    expect(valueStockQuantity(2885.925, coldBrew)).not.toBe(2885.925 * 41000);
  });
  it("does not manufacture zero-value inventory when cost data is absent or incomplete", () => {
    expect(valueStockQuantity(185, undefined)).toBeNull();
    expect(valueStockQuantity(185, { ...coldBrew, complete: false })).toBeNull();
    expect(valueStockQuantity(185, { ...coldBrew, value: null })).toBeNull();
  });
  it("handles a genuine zero-cost item separately from unknown cost", () => {
    expect(valueStockQuantity(10, { ...coldBrew, quantity: 10, value: 0, unitCost: 0 })).toBe(0);
    expect(valueStockQuantity(0, undefined)).toBe(0);
  });
  it("allocates a product balance across variants without duplicating its value", () => {
    const valuation = { ...coldBrew, quantity: 10, value: 27500 };
    expect(valueStockQuantity(3, valuation)! + valueStockQuantity(7, valuation)!).toBe(27500);
  });
});
