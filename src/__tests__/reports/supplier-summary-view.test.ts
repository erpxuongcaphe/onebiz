import { describe, expect, it } from "vitest";
import { reconcileSupplierPayables, supplierSummaryView } from "@/lib/reports/supplier-summary-view";
import type { PayableAgingRow } from "@/lib/services/supabase/finance-marketing-reports";

const payable = (supplierId: string, outstanding: number): PayableAgingRow => ({
  supplierId, supplierName: "Cùng tên", outstanding, documentCount: 1,
  bucket0_30: outstanding, bucket31_60: 0, bucket61_90: 0, bucket91Plus: 0,
  oldestDays: 0, oldestDocumentDate: "2026-10-09",
});
describe("supplier report current payables", () => {
  const purchases = [
    { supplierId: "a", rank: 1, name: "Cùng tên", total: 100, orders: 1, debt: 8277000 },
    { supplierId: "b", rank: 2, name: "Cùng tên", total: 200, orders: 2, debt: 4000944 },
  ];
  it("uses net payable after advances without altering purchase values", () => {
    const result = reconcileSupplierPayables(purchases, [payable("a", 5216997), payable("b", 4000944)]);
    expect(result.reduce((sum, row) => sum + row.debt, 0)).toBe(9217941);
    expect(result.map(row => row.total)).toEqual([100, 200]);
    expect(purchases[0].debt).toBe(8277000);
  });
  it("matches IDs, includes opening-only debt, and clears settled debt", () => {
    const result = reconcileSupplierPayables(purchases, [payable("b", 10), payable("opening", 30)]);
    expect(result.map(row => row.debt)).toEqual([0, 10, 30]);
    expect(result[2].orders).toBe(0);
  });
  it("shares the filtered order between display and export and handles no records", () => {
    const result = supplierSummaryView(purchases, "CÙNG", { id: "debt", direction: "asc" });
    expect(result.map(row => row.supplierId)).toEqual(["b", "a"]);
    expect(supplierSummaryView(purchases, "missing", null)).toEqual([]);
    expect(reconcileSupplierPayables([], [])).toEqual([]);
  });
  it("combines historical names for the same ID without duplicating the supplier", () => {
    const result = reconcileSupplierPayables([], [payable("a", 10), { ...payable("a", 20), supplierName: "Renamed" }]);
    expect(result).toHaveLength(1);
    expect(result[0].debt).toBe(30);
  });
});
