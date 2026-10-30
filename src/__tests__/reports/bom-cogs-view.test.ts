import { expect, it } from "vitest";
import { bomCogsView, bomCogsTotals, bomCogsSheet } from "@/lib/reports/bom-cogs-view";
const rows = [
  { invoiceId: "bill-a", invoiceCode: "HD001", invoiceDate: "2026-10-01T02:00:00Z", branchId: "a", branchName: "Tư Búa", productId: "p1", productCode: "SKU-1", productName: "Xưởng Cốt Dừa", qtySold: 2, revenue: 70000, cogsReal: 10000, margin: 60000, catalogUnit: "Ly", currentConversion: "Chưa có quy đổi phụ" },
  { invoiceId: "bill-b", invoiceCode: "HD002", invoiceDate: "2026-10-02T02:00:00Z", branchId: "b", branchName: "Premium", productId: "p2", productCode: "SKU-2", productName: "Hộp bánh", qtySold: 1, revenue: 30000, cogsReal: null, margin: null, catalogUnit: "Hộp", currentConversion: "1 Hộp = 6 Cái" },
];
const sort = { id: "revenue", direction: "desc" as const };
it.each(["cốt dừa", "cot dua", "CỐT DỪA"])("finds middle-name text %s without requiring its prefix", query => {
  expect(bomCogsView(rows, query, "", "", sort).map(row => row.productCode)).toEqual(["SKU-1"]);
});
it("labels catalog conversions as references, never as historical quantity denominators", () => {
  const view = bomCogsView(rows, "", "", "", sort);
  expect(view.every(row => row.recordedUnit === "Chưa có ĐVT lịch sử")).toBe(true);
  expect(view[1]).toMatchObject({ unitReference: "Hộp", conversionReference: "1 Hộp = 6 Cái", qtySold: 1 });
});
it("uses a matched historical unit even when the current catalog unit differs", () => {
  expect(bomCogsView([{ ...rows[0], recordedUnit: "Cái", catalogUnit: "Cây" }], "", "", "", sort)[0]).toMatchObject({ recordedUnit: "Cái", unitReference: "Cây", qtySold: 2 });
});
it("keeps global numeric sorting and unit/status filters aligned with export", () => {
  const view = bomCogsView(rows, "", "Hộp", "missing", { id: "qtySold", direction: "asc" });
  expect(view.map(row => row.productCode)).toEqual(["SKU-2"]);
  expect(bomCogsSheet(view).rows).toHaveLength(1);
  expect(bomCogsSheet(view).footer).toMatchObject({ revenue: 30000, qtySold: null, recordedUnit: "Không cộng khác ĐVT", cogsReal: null, margin: null });
});
it("separates known subtotals from incomplete totals and retains legitimate zero", () => {
  expect(bomCogsTotals(rows)).toEqual({ revenue: 100000, knownCost: 10000, knownMargin: 60000, missing: 1 });
  const zero = bomCogsView([{ ...rows[0], cogsReal: 0, margin: 70000 }], "", "", "known", sort);
  expect(bomCogsSheet(zero).footer).toMatchObject({ cogsReal: 0, margin: 70000 });
});
