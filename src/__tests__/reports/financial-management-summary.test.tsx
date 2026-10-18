import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FinancialManagementSummary } from "@/components/shared/report/financial-management-summary";
import { financialExportSheets } from "@/lib/reports/financial-export";
import type { ProfitAndLoss } from "@/lib/services/supabase/reports";

const period: ProfitAndLoss = { period: "2026-10", revenue: 1100, goodsRevenue: 1000, deliveryFee: 100, cogs: 400.29, cogsComplete: true, missingCostLines: 0, grossProfit: 599.71, grossMargin: 59.971, operatingExpense: 100, netProfit: 499.71, netMargin: 49.971 };
const range = { from: "2026-10-01", to: "2026-10-18" };
afterEach(cleanup);

describe("financial management summary", () => {
  it("uses goods revenue and scoped evidence without inventing a zero-base percentage", () => {
    render(<FinancialManagementSummary current={period} previous={{ ...period, goodsRevenue: 0, grossProfit: 0, netProfit: 0 }} branchId="fnb" range={range} />);
    expect(screen.getByText("Doanh thu thuần")).toBeInTheDocument();
    expect(screen.getAllByText("Phát sinh mới")).toHaveLength(3);
    expect(screen.queryByText("+100%")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kết quả kinh doanh" })).toHaveAttribute("href", expect.stringContaining("branch=fnb&preset=custom&from=2026-10-01&to=2026-10-18"));
  });

  it("masks profit and margin when historical cost is incomplete", () => {
    render(<FinancialManagementSummary current={{ ...period, cogsComplete: false, missingCostLines: 2 }} previous={period} range={range} />);
    expect(screen.getAllByText("Chưa đủ giá vốn").length).toBeGreaterThan(1);
    expect(screen.queryByText("599.71")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Đối chiếu giá vốn" })).toHaveAttribute("href", expect.stringContaining("branch=all"));
  });

  it("preserves amounts, null costs, percentages, filters and precision in export", () => {
    const rows = [{ money: 400.29, qty: 1.2345, rate: 59.971, missing: null }];
    const [sheet] = financialExportSheets([{ name: "Cost", columns: [{ key: "money", label: "Giá vốn", format: "currency" }, { key: "qty", label: "SL", format: "number" }, { key: "rate", label: "Tỷ lệ", format: "percent" }], rows }], ["Chi nhánh F&B", "01/10 - 18/10", "So với 13/09 - 30/09"]);
    expect(sheet.rows).toBe(rows);
    expect(sheet.columns[0]).toMatchObject({ label: "Giá vốn (đ)", format: "number", decimalPlaces: 2 });
    expect(sheet.columns[1]).toMatchObject({ decimalPlaces: 4 });
    expect(sheet.columns[2].format).toBe("percent");
    expect(sheet.titleRows).toContain("So với 13/09 - 30/09");
  });
});
