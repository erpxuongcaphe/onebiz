import { describe, expect, it } from "vitest";
import { branchPerformanceRows, branchPerformanceTotals, branchPerformanceSheet, BRANCH_FIELDS, EMPTY_BRANCH_FILTER } from "@/lib/reports/branch-performance";
import type { BranchPnLRow } from "@/lib/services/supabase/reports";
import { filterExcelSheetColumns } from "@/lib/utils/excel-export";

const branch = (id: string, revenue: number, profit: number, complete = true): BranchPnLRow => ({ branchId: id, branchName: id, branchType: "fnb", revenue, goodsRevenue: revenue, totalRevenue: revenue + 10, deliveryFee: 10, cogs: revenue - profit, grossProfit: profit, grossMargin: revenue ? profit / revenue * 100 : 0, opEx: 5, otherIncome: 1, netProfit: profit - 4, netMargin: revenue ? (profit - 4) / revenue * 100 : 0, cogsComplete: complete, missingCostLines: complete ? 0 : 2 });
const sort = { id: "netProfit", direction: "asc" as const };
describe("branch performance management table", () => {
  it("compares both periods, retains prior-only branches and sums exact changes", () => {
    const rows = branchPerformanceRows([branch("A", 150, 50)], EMPTY_BRANCH_FILTER, { id: "revenueDifference", direction: "asc" }, [branch("A", 100, 20), branch("closed", 70, 10)]);
    expect(rows.map(row => row.branchId)).toEqual(["closed", "A"]);
    expect(rows[0]).toMatchObject({ goodsRevenue: 0, previousGoodsRevenue: 70, revenueDifference: -70, netProfitDifference: -6 });
    expect(rows[1]).toMatchObject({ previousCogs: 80, previousGrossProfit: 20, previousNetProfit: 16, netProfitDifference: 30 });
    expect(branchPerformanceTotals(rows)).toMatchObject({ goodsRevenue: 150, previousGoodsRevenue: 170, revenueDifference: -20, netProfitDifference: 24 });
    expect(branchPerformanceRows([branch("A", 150, 50)], { ...EMPTY_BRANCH_FILTER, status: "revenueDecline" }, sort, [branch("A", 100, 20), branch("closed", 70, 10)]).map(row => row.branchId)).toEqual(["closed"]);
  });
  it("keeps incomplete prior profit unknown and filterable rather than reporting a fabricated gain", () => {
    const rows = branchPerformanceRows([branch("A", 200, 70)], { ...EMPTY_BRANCH_FILTER, metrics: [{ key: "previousNetProfit", state: "missing", min: null, max: null }] }, sort, [branch("A", 100, 20, false)]);
    expect(rows[0]).toMatchObject({ previousGoodsRevenue: 100, revenueDifference: 100, previousCogs: null, previousNetProfit: null, netProfitDifference: null, previousMissingCostLines: 2 });
    expect(branchPerformanceTotals(rows).netProfitDifference).toBeNull();
  });
  it("keeps every branch and every metric, with missing cost unknown", () => {
    const rows = branchPerformanceRows([branch("A", 100, 20), branch("B", 0, -10), branch("C", 100, 99, false)], EMPTY_BRANCH_FILTER, sort);
    expect(rows.map(row => row.branchId)).toEqual(["B", "A", "C"]);
    expect(rows[2]).toMatchObject({ cogs: null, grossProfit: null, netProfit: null, grossMargin: null, missingCostLines: 2 });
    expect(rows[0].grossMargin).toBeNull();
    expect(rows[1].revenueShare).toBe(50);
    expect(branchPerformanceTotals(rows).netProfit).toBeNull();
  });
  it("filters exact metrics and preserves whole-scope share", () => {
    const source = [branch("A", 100, 20), branch("B", 300, -10)];
    const rows = branchPerformanceRows(source, { ...EMPTY_BRANCH_FILTER, search: "B", status: "loss", metrics: [{ key: "goodsRevenue", state: "range", min: 300, max: 300 }] }, sort);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueShare).toBe(75);
    expect(branchPerformanceTotals(rows)).toMatchObject({ goodsRevenue: 300, netProfit: -14, deliveryFee: 10 });
  });
  it("computes weighted totals instead of summing margins", () => {
    const rows = branchPerformanceRows([branch("A", 100, 50), branch("B", 900, 90)], EMPTY_BRANCH_FILTER, sort);
    expect(branchPerformanceTotals(rows)).toMatchObject({ grossProfit: 140, revenueShare: 100 });
    expect(branchPerformanceTotals(rows).grossMargin).toBeCloseTo(14);
  });
  it("exports all fields in full mode and the exact filtered order with unknown costs blank", () => {
    const filter = { ...EMPTY_BRANCH_FILTER, metrics: [{ key: "goodsRevenue", state: "range" as const, min: 100, max: null }] };
    const rows = branchPerformanceRows([branch("A", 200, 30), branch("B", 300, 99, false), branch("C", 10, 1)], filter, { id: "goodsRevenue", direction: "desc" });
    const full = branchPerformanceSheet(rows, filter, sort, "full", ["Kỳ tháng 10"]);
    expect(full.tablePreferenceKey).toBeUndefined();
    expect(full.columns.map(column => column.key)).toEqual(BRANCH_FIELDS.map(field => field.key));
    expect(full.columnGroups?.reduce((total, group) => total + group.span, 0)).toBe(full.columns.length);
    const visible = filterExcelSheetColumns(full, ["goodsRevenue", "previousNetProfit"]);
    expect(visible.columnGroups?.map(group => group.span)).toEqual([2, 11, 6]);
    expect(full.rows.map(row => row.branchId)).toEqual(["B", "A"]);
    expect(full.rows[0].cogs).toBeNull();
    expect(full.footer).toMatchObject({ goodsRevenue: 500, cogs: null, missingCostLines: 2 });
    expect(full.titleRows?.join(" ")).toContain("Doanh thu thuần: 100 đến Không giới hạn");
    expect(branchPerformanceSheet(rows, filter, sort, "view", []).tablePreferenceKey).toBe("report.financial-results.branches");
  });
});
