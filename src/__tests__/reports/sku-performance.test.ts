import { describe, expect, it } from "vitest";
import type { SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";
import { compareSkuPeriods, filterSkuPerformance, skuCategoryPerformance, skuReviewEvidence } from "@/lib/reports/sku-performance";
import { skuFinancialTotals, skuFinancialView } from "@/lib/reports/sku-financial-view";

export function sku(id: string, revenue: number, cost: number | null = 40, unit = "Ly"): SkuFinancialRow {
  return { productId: id, code: id, name: id, category: "Trà", unit, orders: 1, customers: 1,
    soldQty: 2, returnedQty: 0, netQty: 2, salesAmount: revenue, returnAmount: 0,
    netRevenue: revenue, cogs: cost, grossProfit: cost === null ? null : revenue - cost,
    marginPercent: revenue > 0 && cost !== null ? (revenue - cost) / revenue * 100 : null,
    averageSalePrice: revenue / 2, missingCostLines: cost === null ? 1 : 0, lastActivityAt: "2026-10-18T00:00:00Z" };
}

describe("SKU management evidence", () => {
  it("separates zero-revenue packaging cost from loss alerts without removing cost", () => {
    const rows = compareSkuPeriods([sku("cup", 0, 12), sku("sale", 20, 40), sku("unknown", 0, null)], []);
    expect(skuReviewEvidence(rows)).toMatchObject({ lossCount: 1, lossAmount: -20, zeroRevenueCostCount: 1, zeroRevenueCostAmount: 12, missingCount: 1 });
    expect(filterSkuPerformance(rows, "zeroRevenueCost").map(row => row.code)).toEqual(["cup"]);
    expect(filterSkuPerformance(rows, "loss").map(row => row.code)).toEqual(["sale"]);
    expect(skuFinancialTotals(rows).cogs).toBeNull();
    expect(skuFinancialTotals(rows.slice(0, 2))).toMatchObject({ cogs: 52, grossProfit: -32 });
  });
  it("keeps discontinued sales and matches product plus unit, not just code", () => {
    const rows = compareSkuPeriods([sku("tea", 100, 40, "Ly")], [sku("tea", 200, 80, "Chai"), sku("gone", 300)]);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.code === "gone")).toMatchObject({ netRevenue: 0, orders: 0, soldQty: 0, revenueDifference: -300, lastActivityAt: "" });
    expect(rows.find(row => row.unit === "Ly" && row.code === "tea")?.previousRevenue).toBe(0);
  });

  it("never turns incomplete prior cost into a known profit difference", () => {
    const rows = compareSkuPeriods([sku("tea", 100)], [sku("tea", 120, null)]);
    expect(rows[0]).toMatchObject({ grossProfitDifference: null, previousGrossProfit: null, previousMissingCostLines: 1 });
    expect(filterSkuPerformance(rows, "missing")).toHaveLength(1);
    expect(skuReviewEvidence(rows).missingLines).toBe(1);
  });

  it("prioritizes actual loss and returns without asserting a cause", () => {
    const row = { ...sku("loss", 20, 40), returnedQty: 1, returnAmount: 30 };
    const rows = compareSkuPeriods([row], [sku("loss", 100)]);
    expect(skuReviewEvidence(rows)).toMatchObject({ lossCount: 1, lossAmount: -20, returnCount: 1, returnAmount: 30, declineAmount: -80 });
    expect(filterSkuPerformance(rows, "loss")).toHaveLength(1);
  });

  it("keeps mixed quantities separate and weighted group margin accurate", () => {
    const rows = compareSkuPeriods([sku("a", 100, 20, "G"), sku("b", 300, 200, "Ly")], []);
    expect(skuFinancialTotals(rows).netQty).toBeNull();
    expect(skuCategoryPerformance(rows)[0]).toMatchObject({ netRevenue: 400, grossProfit: 180, margin: 45 });
    const filtered = skuFinancialView(rows, { search: "b", category: "Trà", unit: "Ly" }, { id: "revenueDifference", direction: "desc" });
    expect(filtered.map(row => row.code)).toEqual(["b"]);
  });

  it("masks group profit if any row lacks cost and never invents margin at negative revenue", () => {
    const rows = compareSkuPeriods([sku("a", -20, null)], []);
    expect(skuCategoryPerformance(rows)[0]).toMatchObject({ grossProfit: null, cogs: null, margin: null });
  });
});
