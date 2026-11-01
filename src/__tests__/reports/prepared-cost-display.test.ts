import { describe, expect, it } from "vitest";
import { preparedCostDisplay, preparedCostExportFields } from "@/lib/reports/prepared-cost-display";
import type { FnbBranchComponentCost } from "@/lib/services/supabase/fnb-branch-cost";
const balance = { productId: "synthetic", unitCost: 20, costedQuantity: 100, physicalQuantity: 100 } as FnbBranchComponentCost;
describe("prepared catalog and export cost agreement", () => {
  it("keeps sourced batch valuation distinct from current formula estimate", () => {
    const value = preparedCostDisplay(balance, 30);
    expect(value).toEqual({ value: 20, source: "batch" });
    expect(preparedCostExportFields(value)).toMatchObject({ costPrice: 20, costSource: "Giá vốn theo mẻ" });
  });
  it("uses an explicit formula estimate when the batch balance is unresolved", () => {
    const value = preparedCostDisplay({ ...balance, physicalQuantity: -5 }, 30);
    expect(value).toEqual({ value: 30, source: "recipe" });
    expect(preparedCostExportFields(value)).toMatchObject({ costPrice: 30, costSource: "Dự toán BOM / ĐVT kho" });
  });
  it("preserves real zero and leaves missing or invalid values blank", () => {
    expect(preparedCostExportFields(preparedCostDisplay(undefined, 0)).costPrice).toBe(0);
    for (const price of [undefined, NaN, Infinity, -1]) expect(preparedCostExportFields(preparedCostDisplay(undefined, price)).costPrice).toBeNull();
    expect(preparedCostExportFields({ source: "error" }).costPrice).toBeNull();
    expect(preparedCostDisplay({ ...balance, unitCost: NaN }, undefined)).toBeUndefined();
  });
});
