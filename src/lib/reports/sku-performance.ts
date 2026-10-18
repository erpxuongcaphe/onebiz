import type { SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";
import { skuFinancialTotals } from "./sku-financial-view";

export type SkuReviewFilter = "all" | "loss" | "zeroRevenueCost" | "missing" | "returns" | "decline";
export interface SkuPerformanceRow extends SkuFinancialRow {
  previousRevenue: number;
  revenueDifference: number;
  previousGrossProfit: number | null;
  previousMissingCostLines: number;
  grossProfitDifference: number | null;
  previousRow: SkuFinancialRow | null;
}
const key = (row: SkuFinancialRow) => JSON.stringify([row.productId, row.unit]);

export function compareSkuPeriods(current: SkuFinancialRow[], previous: SkuFinancialRow[]): SkuPerformanceRow[] {
  const before = new Map(previous.map(row => [key(row), row]));
  const now = new Map(current.map(row => [key(row), row]));
  // Include items sold only in the previous period, otherwise lost revenue disappears.
  for (const row of previous) if (!now.has(key(row))) now.set(key(row), {
    ...row, orders: 0, customers: 0, soldQty: 0, returnedQty: 0, netQty: 0,
    salesAmount: 0, returnAmount: 0, netRevenue: 0, cogs: 0, grossProfit: 0,
    marginPercent: null, averageSalePrice: null, missingCostLines: 0, lastActivityAt: "",
  });
  return [...now.values()].map(row => {
    const prior = before.get(key(row));
    const previousGrossProfit = prior ? prior.grossProfit : 0;
    return { ...row, previousRow: prior ?? null, previousMissingCostLines: prior?.missingCostLines ?? 0, previousRevenue: prior?.netRevenue ?? 0,
      revenueDifference: row.netRevenue - (prior?.netRevenue ?? 0), previousGrossProfit,
      grossProfitDifference: row.grossProfit === null || previousGrossProfit === null ? null : row.grossProfit - previousGrossProfit };
  });
}

export function filterSkuPerformance(rows: SkuPerformanceRow[], filter: SkuReviewFilter) {
  return rows.filter(row => filter === "all" || (filter === "loss" && row.grossProfit !== null && row.grossProfit < 0 && !isZeroRevenueCost(row))
    || (filter === "zeroRevenueCost" && isZeroRevenueCost(row))
    || (filter === "missing" && (row.missingCostLines > 0 || row.cogs === null || row.previousMissingCostLines > 0 || row.previousGrossProfit === null))
    || (filter === "returns" && row.returnedQty > 0)
    || (filter === "decline" && row.revenueDifference < 0));
}

function isZeroRevenueCost(row: SkuPerformanceRow) {
  return row.soldQty > 0 && row.salesAmount === 0 && row.returnAmount === 0 && row.netRevenue === 0 && row.cogs !== null && row.cogs > 0;
}

export function skuReviewEvidence(rows: SkuPerformanceRow[]) {
  const loss = filterSkuPerformance(rows, "loss");
  const missing = filterSkuPerformance(rows, "missing");
  const decline = filterSkuPerformance(rows, "decline");
  const returns = filterSkuPerformance(rows, "returns");
  const zeroRevenueCost = filterSkuPerformance(rows, "zeroRevenueCost");
  return { lossCount: loss.length, lossAmount: loss.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0),
    zeroRevenueCostCount: zeroRevenueCost.length, zeroRevenueCostAmount: zeroRevenueCost.reduce((sum, row) => sum + (row.cogs ?? 0), 0),
    missingCount: missing.length, missingLines: missing.reduce((sum, row) => sum + row.missingCostLines + row.previousMissingCostLines, 0),
    declineCount: decline.length, declineAmount: decline.reduce((sum, row) => sum + row.revenueDifference, 0),
    returnCount: returns.length, returnAmount: returns.reduce((sum, row) => sum + row.returnAmount, 0) };
}

export function skuCategoryPerformance(rows: SkuPerformanceRow[]) {
  const groups = new Map<string, SkuPerformanceRow[]>();
  for (const row of rows) {
    const items = groups.get(row.category) ?? [];
    items.push(row);
    groups.set(row.category, items);
  }
  return [...groups].map(([category, items]) => {
    const totals = skuFinancialTotals(items);
    return { category: category || "Chưa phân loại", skuUnits: items.length, netRevenue: totals.netRevenue,
      cogs: totals.cogs, grossProfit: totals.grossProfit,
      margin: totals.netRevenue > 0 && totals.grossProfit !== null ? totals.grossProfit / totals.netRevenue * 100 : null };
  }).sort((a, b) => b.netRevenue - a.netRevenue || a.category.localeCompare(b.category, "vi"));
}
