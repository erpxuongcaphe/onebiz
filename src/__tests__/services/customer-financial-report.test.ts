import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }), handleError: (error: {message: string}) => { throw new Error(error.message); } }));
import { getCustomerFinancialReport } from "@/lib/services/supabase/customer-financial-report";
const range = { from: "2026-10-01", to: "2026-10-29" };
beforeEach(() => rpc.mockReset());

describe("customer financial report contract", () => {
  it.each([null, {}, { rows: null }, { rows: {} }, { rows: [null] }, { rows: [{}] }])("rejects incomplete data %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getCustomerFinancialReport(range, "branch-a")).rejects.toThrow();
  });
  it("keeps a valid empty source distinct from failure", async () => {
    rpc.mockResolvedValue({ data: { rows: [] }, error: null });
    expect(await getCustomerFinancialReport(range, "branch-a")).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("get_customer_financial_report", expect.objectContaining({ p_branch_id: "branch-a" }));
  });
  it("keeps unnamed customers and unknown historical cost without inventing an identity or zero", async () => {
    rpc.mockResolvedValue({ data: { rows: [{ customer_id: null, code: "", name: "Unnamed", order_count: 1, return_count: 0, product_count: 1, sales_amount: "100", return_amount: 0, net_revenue: 100, cogs: null, gross_profit: null, margin_percent: null, average_order_value: 100, missing_cost_lines: 1 }] }, error: null });
    expect(await getCustomerFinancialReport(range)).toEqual([expect.objectContaining({ customerId: null, netRevenue: 100, cogs: null, grossProfit: null })]);
  });
  it("does not mask permission failures with a fallback source", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "REPORT_BRANCH_DENIED" } });
    await expect(getCustomerFinancialReport(range, "other")).rejects.toThrow("REPORT_BRANCH_DENIED");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
