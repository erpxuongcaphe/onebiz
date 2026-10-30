import { describe, expect, it } from "vitest";
import { agingView, agingTotals, agingBuckets, agingSheet } from "@/lib/reports/inventory-aging-view";
import type { InventoryAgingRow } from "@/lib/services/supabase/inventory-reports";
const row = (extra: Partial<InventoryAgingRow> = {}): InventoryAgingRow => ({ productId: "p", code: "SKU-CUP", name: "Xưởng Cốt Dừa", currentQty: 2, costPrice: 10, stockValue: 20,
  catalogUnit: "Cái", currentConversion: "1 Cây = 50 Cái", lastInDate: "2026-10-01", daysInStock: 29, lastSaleDate: null, daysSinceLastSale: null, agingBucket: "0-30", isDeadStock: true, ...extra });
describe("inventory movement view", () => {
  it("does not call a newly received unsold product dead stock", () => {
    expect(agingView([row()], "", "", "all", null)[0]).toMatchObject({ needsReview: false, reviewStatus: "Chưa quá ngưỡng" });
  });
  it("separates unknown history instead of converting it to zero days", () => {
    const view = agingView([row({ lastInDate: null, daysInStock: null, agingBucket: "unknown" })], "", "", "insufficient", null);
    expect(view[0]).toMatchObject({ insufficientHistory: true, needsReview: false });
    expect(agingSheet(view).rows[0]).toMatchObject({ daysInStock: null, daysSinceLastSale: null, lastSaleDate: "Chưa có dữ liệu" });
  });
  it("reviews old unsold receipts but not exactly 60 full days", () => {
    expect(agingView([row({ daysInStock: 61 })], "", "", "review", null)).toHaveLength(1);
    expect(agingView([row({ daysInStock: 60 })], "", "", "review", null)).toHaveLength(0);
  });
  it("uses known last sale over last receipt when available", () => {
    expect(agingView([row({ daysInStock: 100, lastSaleDate: "2026-10-29", daysSinceLastSale: 1 })], "", "", "review", null)).toHaveLength(0);
    expect(agingView([row({ daysInStock: 1, lastSaleDate: "2026-07-01", daysSinceLastSale: 121 })], "", "", "review", null)).toHaveLength(1);
  });
  it("filters middle-name unaccented search and units before totals/buckets/export", () => {
    const view = agingView([row(), row({ productId: "b", code: "SKU-B", name: "Ly giấy", catalogUnit: "Thùng", stockValue: 100 })], "cot dua", "Cái", "all", null);
    expect(view).toHaveLength(1); expect(agingTotals(view).knownValue).toBe(20);
    expect(agingBuckets(view).reduce((sum, group) => sum + group.count, 0)).toBe(1);
    expect(agingSheet(view).rows).toHaveLength(1);
  });
  it("keeps null monetary values incomplete while preserving a genuine zero", () => {
    const source = [row({ stockValue: null, costPrice: null }), row({ productId: "b", stockValue: 0, costPrice: 0 })];
    expect(agingTotals(source)).toEqual({ count: 2, knownValue: 0, missingValues: 1 });
    expect(agingBuckets(source)[0].value).toBeNull();
    const sheet = agingSheet(agingView(source, "", "", "all", null));
    expect(sheet.footer?.stockValue).toBeNull(); expect(sheet.rows[1].stockValue).toBe(0); expect(sheet.footer?.currentQty).toBeNull();
  });
  it("sorts all rows with unknown values last and never sums mixed quantities", () => {
    const source = [row({ daysInStock: null }), row({ productId: "b", daysInStock: 70 }), row({ productId: "c", daysInStock: 2 })];
    const view = agingView(source, "", "", "all", { id: "daysInStock", direction: "desc" });
    expect(view.map(item => item.productId)).toEqual(["b", "c", "p"]);
    expect(agingSheet(view).footer).toMatchObject({ currentQty: null, unitLabel: "Không cộng khác ĐVT" });
  });
});
