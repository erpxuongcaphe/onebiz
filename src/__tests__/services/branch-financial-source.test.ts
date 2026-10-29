import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }), getCurrentTenantId: async () => "tenant-test", handleError: (error: { message: string }) => { throw new Error(error.message); } }));
import { getBranchPnLComparison } from "@/lib/services/supabase/reports";
const range = { from: "2026-10-01", to: "2026-10-29" };
const row = () => ({ branch_id: "branch-test", branch_name: "Fixture", branch_type: "office", total_revenue: "1100", delivery_fee: "100", goods_revenue: "1000", other_income: "50", operating_expense: "200", cogs: "400", gross_profit: "600", gross_margin: "60", operating_result: "450", operating_margin: "45", cogs_complete: true, missing_cost_lines: 0 });
beforeEach(() => rpc.mockReset());
describe("branch financial source", () => {
  it("preserves valid numeric strings and includes other income in operating results", async () => {
    rpc.mockResolvedValue({ data: { rows: [row()] }, error: null });
    expect(await getBranchPnLComparison(range)).toEqual([expect.objectContaining({ goodsRevenue: 1000, cogs: 400, otherIncome: 50, netProfit: 450 })]);
    expect(rpc).toHaveBeenCalledWith("get_branch_profit_and_loss_report_v2", { p_date_from: "2026-09-30T17:00:00.000Z", p_date_to: "2026-10-29T17:00:00.000Z" });
  });
  it.each([null, {}, { rows: null }, { rows: {} }, { rows: [null] }, { rows: [{}] }])("rejects incomplete payload %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getBranchPnLComparison(range)).rejects.toThrow();
  });
  it.each(["goods_revenue", "total_revenue", "delivery_fee", "other_income", "operating_expense", "missing_cost_lines", "cogs", "gross_profit", "operating_result", "gross_margin", "operating_margin"])("does not publish a missing %s as zero", async key => {
    const data: Record<string, unknown> = row(); delete data[key];
    rpc.mockResolvedValue({ data: { rows: [data] }, error: null });
    await expect(getBranchPnLComparison(range)).rejects.toThrow();
  });
  it.each([null, "", true, Infinity, "not-a-number"])("rejects invalid revenue %j", async goods_revenue => {
    rpc.mockResolvedValue({ data: { rows: [{ ...row(), goods_revenue }] }, error: null });
    await expect(getBranchPnLComparison(range)).rejects.toThrow();
  });
  it.each([{ cogs_complete: "true" }, { missing_cost_lines: -1 }, { missing_cost_lines: 1.5 }, { missing_cost_lines: 1 }, { gross_profit: 601 }, { operating_result: 451 }, { total_revenue: 1200 }])("rejects inconsistent source %j", async patch => {
    rpc.mockResolvedValue({ data: { rows: [{ ...row(), ...patch }] }, error: null });
    await expect(getBranchPnLComparison(range)).rejects.toThrow();
  });
  it.each([null, 400])("keeps incomplete cost and derived results unknown even if legacy values exist: %j", async cogs => {
    rpc.mockResolvedValue({ data: { rows: [{ ...row(), cogs, cogs_complete: false, missing_cost_lines: 2 }] }, error: null });
    expect((await getBranchPnLComparison(range))[0]).toMatchObject({ goodsRevenue: 1000, otherIncome: 50, opEx: 200, cogs: null, grossProfit: null, grossMargin: null, netProfit: null, netMargin: null, missingCostLines: 2 });
  });
  it("rejects duplicate branches instead of counting their revenue twice", async () => {
    rpc.mockResolvedValue({ data: { rows: [row(), row()] }, error: null });
    await expect(getBranchPnLComparison(range)).rejects.toThrow("dòng trùng");
  });
  it("keeps a valid return-only period negative instead of clamping it to zero", async () => {
    rpc.mockResolvedValue({ data: { rows: [{ ...row(), total_revenue: -100, goods_revenue: -100, delivery_fee: 0, cogs: -60, gross_profit: -40, other_income: 0, operating_expense: 0, operating_result: -40, gross_margin: 0, operating_margin: 0 }] }, error: null });
    expect((await getBranchPnLComparison(range))[0]).toMatchObject({ goodsRevenue: -100, cogs: -60, grossProfit: -40, netProfit: -40 });
  });
  it.each([{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-10-29", to: "2026-10-01" }])("does not fall back to this month for an invalid selected range", async invalid => {
    await expect(getBranchPnLComparison(invalid)).rejects.toThrow("thời gian");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts a confirmed empty report without inventing a branch", async () => {
    rpc.mockResolvedValue({ data: { rows: [] }, error: null });
    expect(await getBranchPnLComparison(range)).toEqual([]);
  });
  it("preserves access denial without fallback", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "REPORT_ALL_BRANCHES_DENIED" } });
    await expect(getBranchPnLComparison(range)).rejects.toThrow("REPORT_ALL_BRANCHES_DENIED");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
