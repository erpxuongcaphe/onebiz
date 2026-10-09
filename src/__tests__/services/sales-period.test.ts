import { describe, expect, it } from "vitest";
import { groupSalesPeriods, salesPeriodRange } from "@/lib/reports/sales-period";
import type { SalesReportDailyRow } from "@/lib/services/supabase/analytics";
import { readFileSync } from "node:fs";

const row = (date: string, revenue: number): SalesReportDailyRow => ({ date, orderCount: 1, soldQty: 2, grossRevenue: revenue, returnAmount: 10, netRevenue: revenue - 10, paid: 40, debt: revenue - 40 });

describe("sales period aggregation", () => {
  it("keeps original day rows without mutation", () => {
    const rows = [row("2026-10-09", 100)];
    expect(groupSalesPeriods(rows, "day")).toBe(rows);
  });
  it("groups Monday to Sunday and preserves every additive metric", () => {
    const rows = [row("2026-10-04", 100), row("2026-10-05", 200), row("2026-10-11", 300)];
    const result = groupSalesPeriods(rows, "week");
    expect(result.map((r) => r.date)).toEqual(["2026-09-28", "2026-10-05"]);
    expect(result[1]).toEqual({ date: "2026-10-05", orderCount: 2, soldQty: 4, grossRevenue: 500, returnAmount: 20, netRevenue: 480, paid: 80, debt: 420 });
    expect(rows[1].grossRevenue).toBe(200);
  });
  it("handles weeks across year boundaries without local timezone shifts", () => {
    expect(groupSalesPeriods([row("2027-01-01", 100)], "week")[0].date).toBe("2026-12-28");
  });
  it("groups months and retains return-only negative revenue", () => {
    const returns = { ...row("2026-10-01", 0), orderCount: 0, soldQty: 0, netRevenue: -10, paid: 0, debt: 0 };
    expect(groupSalesPeriods([row("2026-09-30", 100), returns], "month").map((r) => r.netRevenue)).toEqual([90, -10]);
  });
  it("bounds drilldowns to the selected partial week", () => {
    expect(salesPeriodRange("2026-10-05", "week", { from: "2026-10-07", to: "2026-10-09" })).toEqual({ from: "2026-10-07", to: "2026-10-09" });
  });
  it("handles leap months and empty reports", () => {
    expect(salesPeriodRange("2028-02-01", "month", { from: "2028-01-01", to: "2028-12-31" }).to).toBe("2028-02-29");
    expect(groupSalesPeriods([], "week")).toEqual([]);
  });
  it("wires the same period rows and labels into table and Excel", () => {
    const page = readFileSync("src/app/(main)/phan-tich/ban-hang/page.tsx", "utf8");
    expect(page).toContain("rows={periodRows}");
    expect(page).toContain("rows: periodRows.map");
    expect(page).toContain("date: formatPeriod(row.date)");
  });
  it("makes end-of-day tabular, keeps drilldowns scoped and prevents stale success data", () => {
    const page = readFileSync("src/app/(main)/phan-tich/cuoi-ngay/page.tsx", "utf8");
    expect(page).toContain('defaultViewMode: "table"');
    expect(page).toContain("getSalesReportDailyRows(activeBranchId, range)");
    expect(page).toContain("buildSalesInvoiceDayLink(row.date, activeBranchId)");
    expect(page).toContain("request !== requestId.current");
    expect(page).toContain("setStats(null)");
    expect(page).toContain('tablePreferenceKey: "report.cuoi-ngay.hours"');
    expect(page).toContain('tablePreferenceKey: "report.cuoi-ngay.products"');
    expect(page).toContain('label: "Đã thu theo HĐ"');
  });
});
