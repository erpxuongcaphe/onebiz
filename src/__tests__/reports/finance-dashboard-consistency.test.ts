import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn(() => Promise.resolve("tenant-1")),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { getFinanceDashboardReport } from "@/lib/services/supabase/analytics";

const page = readFileSync(
  "src/app/(main)/phan-tich/tai-chinh/page.tsx",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/analytics.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00258_finance_dashboard_consistency.sql",
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      current: {
        revenue: 1_000,
        delivery_fee: 100,
        cogs: 300,
        operating_expense: 100,
      },
      previous: {
        revenue: 800,
        delivery_fee: 50,
        cogs: 250,
        operating_expense: 100,
      },
      granularity: "month",
      trend: [
        {
          bucket_start: "2026-07-01T00:00:00Z",
          goods_revenue: 900,
          cogs: 300,
          operating_expense: 100,
          total_expense: 400,
          profit: 500,
        },
      ],
      expense_breakdown: [
        { name: "Giá vốn hàng bán", value: 300 },
        { name: "Tiền thuê", value: 100 },
      ],
    },
    error: null,
  });
});

describe("finance dashboard consistency", () => {
  it("derives revenue, expense and profit from the same P&L response", async () => {
    const report = await getFinanceDashboardReport("branch-1", {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    expect(report.kpis).toMatchObject({
      revenue: 900,
      expense: 400,
      profit: 500,
    });
    expect(report.trend[0]).toMatchObject({
      revenue: 900,
      expense: 400,
      profit: 500,
    });
    expect(report.expenseBreakdown).toEqual([
      { name: "Giá vốn hàng bán", value: 300 },
      { name: "Tiền thuê", value: 100 },
    ]);
  });

  it("loads KPI, trend and expense structure through one report RPC", () => {
    expect(page).toContain("getFinanceDashboardReport");
    expect(page).not.toContain("getRevenueVsExpense(12");
    expect(page).not.toContain("getExpenseBreakdown(activeBranchId");
    expect(migration).toContain("public.get_profit_and_loss_report");
    expect(migration).toContain("public.get_consolidated_profit_and_loss_report");
    expect(migration).toContain("if p_branch_id is null then");
    expect(migration).toContain("i.source = 'internal'");
    expect(migration).toContain("source_invoice.source = 'internal'");
    expect(migration).toContain("'Giá vốn hàng bán'");
    expect(migration).toContain("'Trả nhà cung cấp'");
    expect(migration).toContain("'supplier_payment'");
  });

  it("excludes unfinished cash vouchers from cash-flow reports", () => {
    const cashFlowStart = service.indexOf("export async function getCashFlow(");
    const cashFlowEnd = service.indexOf(
      "export interface CashFlowByCategory",
      cashFlowStart,
    );
    const detailedStart = service.indexOf(
      "export async function getCashFlowDetailed(",
    );
    const detailedEnd = service.indexOf(
      "export interface ChannelRevenueSplit",
      detailedStart,
    );

    expect(service.slice(cashFlowStart, cashFlowEnd)).toContain(
      '.eq("status", "completed")',
    );
    expect(service.slice(detailedStart, detailedEnd)).toContain(
      '.eq("status", "completed")',
    );
  });
});
