import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, from, cashRange } = vi.hoisted(() => {
  const cash: Record<string, ReturnType<typeof vi.fn>> = {};
  cash.order = vi.fn(() => cash); cash.range = vi.fn();
  const invoice: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "gte", "lt", "order"]) invoice[name] = vi.fn(() => invoice);
  invoice.range = vi.fn(async () => ({ data: [{ ngay_chung_tu: "2026-09-15T12:00:00Z", total: 500 }], error: null }));
  return { rpc: vi.fn(() => cash), from: vi.fn(() => invoice), cashRange: cash.range };
});
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc, from }), getCurrentTenantId: async () => "tenant-1",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getExpenseBreakdown, getRevenueVsExpense } from "@/lib/services/supabase/analytics";
beforeEach(() => { rpc.mockClear(); from.mockClear(); cashRange.mockReset(); });
describe("cash expense report projection", () => {
  it("calculates the same expense categories and revenue comparison from scoped totals", async () => {
    cashRange.mockResolvedValue({ data: [
      {year:2026,month:9,category:"Vận hành",amount:"120"},
      {year:2026,month:9,category:"Khác",amount:"30"},
    ], error: null });
    const range={from:"2026-09-01",to:"2026-09-30"};
    expect(await getExpenseBreakdown("branch-1",range)).toEqual([{name:"Vận hành",value:120},{name:"Khác",value:30}]);
    expect(await getRevenueVsExpense(1,"branch-1",range)).toEqual([{label:"T9/2026",revenue:500,expense:150}]);
    expect(rpc).toHaveBeenCalledWith("get_cash_expense_report_totals",expect.objectContaining({p_branch:"branch-1"}));
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("invoices");
  });
  it("surfaces report source errors", async () => {
    cashRange.mockResolvedValue({data:null,error:{message:"CASH_PROJECTION_FAILED"}});
    await expect(getExpenseBreakdown("branch-1",{from:"2026-09-01",to:"2026-09-30"})).rejects.toThrow("CASH_PROJECTION_FAILED");
  });
});
