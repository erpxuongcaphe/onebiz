import { describe, expect, it } from "vitest";
import { inventoryBalance, inventoryCapitalCategories, inventoryCapitalSummary, inventoryReviewExportRows, matchesInventoryReview, INVENTORY_METRIC_FIELDS } from "@/lib/reports/inventory-capital";
import type { XntRow } from "@/lib/services/supabase/xnt-report";

function item(patch: Partial<XntRow> = {}): XntRow {
  return { productId: "a", code: "A", name: "Tea", unit: "G", categoryName: "Tea", openingQty: 10, openingValue: 100,
    totalIn: 5, inValue: 50, totalOut: 2, outValue: 20, closingQty: 13, closingValue: 130,
    inSupplier: 5, inCheck: 0, inReturn: 0, inTransfer: 0, inProduction: 0, inOther: 0,
    outSale: 2, outDisposal: 0, outSupplierReturn: 0, outCheck: 0, outTransfer: 0, outProduction: 0, outInternal: 0, outOther: 0,
    valuedMovementCount: 2, missingCostMovementCount: 0, valuationComplete: true, ...patch };
}
describe("inventory capital evidence", () => {
  it("does not present known partial stock value as a complete total", () => {
    const rows = [item(), item({ productId: "b", unit: "Ly", closingValue: null, valuationComplete: false })];
    expect(inventoryCapitalSummary(rows)).toMatchObject({ closingValue: null, knownClosingValue: 130, missing: 1 });
    expect(inventoryCapitalCategories(rows)[0]).toMatchObject({ closingValue: null, products: 2 });
    expect(inventoryCapitalSummary(rows)).not.toHaveProperty("quantity");
  });
  it("distinguishes no issues in this period from an assertion of dead stock", () => {
    const row = item({ totalOut: 0, outSale: 0 });
    expect(matchesInventoryReview(row, "noOut")).toBe(true);
    expect(inventoryCapitalSummary([row])).toMatchObject({ noOut: 1, noOutValue: 130 });
    expect(matchesInventoryReview(item({ closingQty: -1 }), "noOut")).toBe(false);
  });
  it("checks quantity and value balances independently and preserves unknown values", () => {
    expect(inventoryBalance(item())).toEqual({ quantityDifference: 0, valueDifference: 0, mismatch: false });
    expect(inventoryBalance(item({ closingValue: null }))).toEqual({ quantityDifference: 0, valueDifference: null, mismatch: false });
    expect(inventoryBalance(item({ closingQty: 12, closingValue: null })).mismatch).toBe(true);
    expect(inventoryBalance(item({ closingValue: 131 })).mismatch).toBe(true);
    expect(inventoryBalance(item({ closingValue: 130.000000001 })).mismatch).toBe(false);
  });
  it("groups by category, keeps signed stock values and exports the same evidence", () => {
    const rows = [item(), item({ productId: "b", categoryName: null, closingQty: -1, closingValue: -10 })];
    expect(inventoryCapitalSummary(rows)).toMatchObject({ closingValue: 120, negative: 1 });
    expect(inventoryCapitalCategories(rows).map(row => row.category)).toEqual(["Tea", "Chưa phân nhóm"]);
    expect(inventoryReviewExportRows(rows)[1]).toMatchObject({ negative: "Có", closingValue: -10 });
    expect(new Set(INVENTORY_METRIC_FIELDS.map(field => field.key)).size).toBe(INVENTORY_METRIC_FIELDS.length);
    expect(INVENTORY_METRIC_FIELDS).toContainEqual({ key: "outSaleValue", label: "Bán hàng / BOM · Thành tiền" });
  });
  it("shares category sorting with full exports and leaves missing values last", () => {
    const rows = [item({ categoryName: "Unknown", closingValue: null }), item({ categoryName: "Low", closingValue: 50 }), item({ categoryName: "High", closingValue: 200 })];
    expect(inventoryCapitalCategories(rows, { id: "closingValue", direction: "desc" }).map(row => row.category)).toEqual(["High", "Low", "Unknown"]);
  });
});
