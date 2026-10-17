import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getBranchPnLComparison, getConsolidatedPnL, getProfitAndLoss } from "@/lib/services/supabase/reports";

const snapshot = {
  revenue: 1100, delivery_fee: 100, cogs: 400, cogs_complete: true,
  missing_sales_cost_lines: 0, missing_return_cost_lines: 0, operating_expense: 200, other_income: 50,
  legacy_cash_expense: 25,
};
beforeEach(() => rpc.mockReset());

describe("shared management financial source", () => {
  it("includes other income in consolidated results just as in branch results", async () => {
    rpc.mockResolvedValue({ data: { current: snapshot, previous: snapshot }, error: null });
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const branch = await getProfitAndLoss("branch-1", range);
    const all = await getConsolidatedPnL(range);
    expect(all.current).toMatchObject({ goodsRevenue: 1000, grossProfit: 600, otherIncome: 50, netProfit: 450, legacyCashExpense: 25 });
    expect(all.current.netProfit).toBe(branch.current.netProfit);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_profit_and_loss_report_v2", expect.objectContaining({ p_branch_id: "branch-1", p_exclude_internal: false }));
    expect(rpc).toHaveBeenNthCalledWith(2, "get_profit_and_loss_report_v2", expect.objectContaining({ p_branch_id: null, p_exclude_internal: true }));
  });

  it("preserves historical-cost completeness instead of replacing it with current cost", async () => {
    rpc.mockResolvedValue({ data: { current: { ...snapshot, cogs_complete: false, missing_sales_cost_lines: 3 }, previous: snapshot }, error: null });
    expect((await getConsolidatedPnL()).current).toMatchObject({ cogsComplete: false, missingCostLines: 3 });
  });

  it("retains non-selling office branches and their other income", async () => {
    rpc.mockResolvedValue({ data: { rows: [{ branch_id: "office-1", branch_name: "Văn phòng", branch_type: "office", goods_revenue: 0, other_income: 50, operating_expense: 200, operating_result: -150, cogs_complete: true }] }, error: null });
    const rows = await getBranchPnLComparison();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ branchId: "office-1", branchType: "office", otherIncome: 50, netProfit: -150 });
  });

  it("propagates report failures instead of returning a valid-looking zero result", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(getConsolidatedPnL()).rejects.toThrow("permission denied");
  });
});
