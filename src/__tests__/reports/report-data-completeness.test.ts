import { describe, expect, it } from "vitest";
import { materialConsumptionView, materialConsumptionTotals } from "@/lib/reports/material-consumption-view";
import { skuFinancialView, skuFinancialTotals } from "@/lib/reports/sku-financial-view";
import type { SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";

const material = { branchId: "b", branchName: "Quán", materialId: "m", materialCode: "NVL-02", materialName: "Cà phê", unit: "G", totalQty: 100, totalCost: 30000, movementCount: 2 };
describe("material report source parity", () => {
  it("does not turn unknown cost into zero or price", () => {
    const rows = materialConsumptionView([{ ...material, totalCost: null }, { ...material, materialId: "free", totalCost: 0 }], "", "", { id: "totalCost", direction: "desc" });
    expect(rows[0].averageUnitCost).toBe(0);
    expect(rows[1].averageUnitCost).toBeNull();
    expect(materialConsumptionTotals(rows)).toMatchObject({ totalCost: null, knownCost: 0, missing: 1 });
  });
  it("uses the same filtered and sorted source for table and export", () => {
    const rows = materialConsumptionView([material, { ...material, materialCode: "NVL-01", totalCost: 20000 }, { ...material, unit: "Kg" }], "cà phê", "G", { id: "materialCode", direction: "asc" });
    expect(rows.map(row => row.materialCode)).toEqual(["NVL-01", "NVL-02"]);
    expect(rows[0].averageUnitCost).toBe(200);
    expect(materialConsumptionTotals(rows).totalCost).toBe(50000);
  });
  it("never adds mixed-unit quantities", () => {
    const rows = materialConsumptionView([material, { ...material, unit: "Kg" }], "", "", { id: "materialCode", direction: "asc" });
    expect(materialConsumptionTotals(rows).quantity).toBeNull();
  });
});
const sku: SkuFinancialRow = { productId: "p", code: "SKU-02", name: "Cà phê", category: "Đồ uống", unit: "Ly", orders: 2, customers: 1,
  soldQty: 3, returnedQty: 1, netQty: 2, salesAmount: 90000, returnAmount: 30000, netRevenue: 60000, cogs: 20000, grossProfit: 40000,
  marginPercent: 66.6667, averageSalePrice: 30000, missingCostLines: 0, lastActivityAt: "2026-10-09" };
describe("SKU financial view", () => {
  it("keeps unknown profit distinct from actual zero", () => {
    expect(skuFinancialTotals([sku, { ...sku, cogs: null, grossProfit: null, missingCostLines: 1 }])).toMatchObject({ cogs: null, grossProfit: null, missing: 1, netRevenue: 120000 });
    expect(skuFinancialTotals([{ ...sku, cogs: 60000, grossProfit: 0 }]).grossProfit).toBe(0);
  });
  it("filters category/unit/code and sorts numerically", () => {
    const rows = skuFinancialView([sku, { ...sku, code: "SKU-01", netRevenue: 10000 }, { ...sku, unit: "Kg" }], { search: "sku", category: "Đồ uống", unit: "Ly" }, { id: "netRevenue", direction: "asc" });
    expect(rows.map(row => row.code)).toEqual(["SKU-01", "SKU-02"]);
    expect(skuFinancialTotals(rows).netQty).toBe(4);
  });
  it("does not sum invoice/customer counts across products or average prices", () => {
    const total = skuFinancialTotals([sku, { ...sku, unit: "Kg" }]);
    expect(total.netQty).toBeNull();
    expect(total).not.toHaveProperty("orders");
    expect(total).not.toHaveProperty("averageSalePrice");
  });
});
