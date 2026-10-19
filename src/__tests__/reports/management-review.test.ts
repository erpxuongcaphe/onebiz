import { describe, expect, it } from "vitest";
import { managementComparisonRange, managementFinancialRows, managementObservations, managementReportLink, reportChange, sortManagementBranches } from "@/lib/reports/management-review";
import type { BranchPnLRow, ProfitAndLoss } from "@/lib/services/supabase/reports";

const pnl: ProfitAndLoss = {
  period: "2026-09", revenue: 1000, goodsRevenue: 1000, deliveryFee: 0,
  cogs: 400, cogsComplete: true, missingCostLines: 0,
  grossProfit: 600, grossMargin: 60, operatingExpense: 200,
  otherIncome: 50, netProfit: 450, netMargin: 45,
};

describe("management reporting", () => {
  it("does not infer an expense trend while internal source costs are incomplete",()=>{
    const incomplete={...pnl,cogsComplete:false,missingCostLines:1,missingExpenseCostLines:1,operatingExpenseComplete:false,operatingExpense:900};
    expect(managementObservations(incomplete,pnl)[0]).toMatchObject({title:'Chưa đủ giá vốn nguồn',path:'/tai-chinh/thu-nhap-chi-phi'});
    expect(managementObservations(incomplete,pnl).some(row=>row.id==='expense-increase')).toBe(false);
    expect(managementFinancialRows(incomplete,pnl).find(row=>row.metric==='Chi phí vận hành')).toMatchObject({current:null,difference:null});
  });
  it("does not invent percentage growth from zero or accept non-finite input", () => {
    expect(reportChange(10, 0)).toBe("Phát sinh mới");
    expect(reportChange(0, 0)).toContain("Không phát sinh");
    expect(reportChange(0, -10)).toBe("+100.0%");
    expect(reportChange(NaN, 10)).toContain("Chưa đủ dữ liệu");
  });

  it("keeps the exact date and branch scope when drilling down", () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const url = new URL(managementReportLink("/phan-tich/ban-hang", "branch-1", range), "https://onebiz.com.vn");
    expect(Object.fromEntries(url.searchParams)).toEqual({ branch: "branch-1", preset: "custom", ...range, view: "table" });
    expect(managementReportLink("/phan-tich/ban-hang", undefined, range)).toContain("branch=all");
  });

  it("masks unknown historical cost and profit in both periods without mutating input", () => {
    const incomplete = Object.freeze({ ...pnl, cogsComplete: false, missingCostLines: 2 });
    const rows = managementFinancialRows(incomplete, pnl);
    expect(rows.find(row => row.metric === "Giá vốn")).toMatchObject({ current: null, previous: 400, difference: null });
    expect(rows.at(-1)).toMatchObject({ current: null, previous: 450, difference: null });
    expect(rows.find(row => row.metric === "Thu nhập khác")?.current).toBe(50);
    expect(incomplete.cogs).toBe(400);
    const observations = managementObservations(incomplete, pnl);
    expect(observations[0].id).toBe("cost-incomplete");
    expect(observations.some(row => row.id === "margin-pressure")).toBe(false);
  });

  it("offers an investigation, not an invented explanation or automatic mutation", () => {
    const rows = managementObservations({ ...pnl, goodsRevenue: 1200, grossProfit: 500 }, pnl);
    expect(rows[0].id).toBe("margin-pressure");
    expect(rows[0].detail).toContain("Kiểm tra giá bán");
    expect(rows[0].path).toBe("/phan-tich/sku-chi-tiet");
    expect(managementObservations(pnl, pnl)[0].id).toBe("review-period");
  });

  it("keeps office rows and sorts unknown cost last in either direction", () => {
    const branches = [
      { branchId: "unknown", branchType: "store", cogs: 0, cogsComplete: false },
      { branchId: "office", branchType: "office", cogs: 0, cogsComplete: true },
      { branchId: "factory", branchType: "factory", cogs: 400, cogsComplete: true },
    ] as BranchPnLRow[];
    expect(sortManagementBranches(branches, { id: "cogs", direction: "asc" }).map(row => row.branchId)).toEqual(["office", "factory", "unknown"]);
    expect(sortManagementBranches(branches, { id: "cogs", direction: "desc" }).map(row => row.branchId)).toEqual(["factory", "office", "unknown"]);
    expect(branches[0].branchId).toBe("unknown");
  });

  it("uses the same adjacent comparison period as the financial service", () => {
    expect(managementComparisonRange({ from: "2026-10-01", to: "2026-10-18" })).toEqual({ from: "2026-09-13", to: "2026-09-30" });
    expect(managementComparisonRange({ from: "2026-01-01", to: "2026-01-01" })).toEqual({ from: "2025-12-31", to: "2025-12-31" });
    expect(managementComparisonRange({ from: "2024-03-01", to: "2024-03-01" })).toEqual({ from: "2024-02-29", to: "2024-02-29" });
  });
});
