import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, order, range, from } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.order = vi.fn(() => chain);
  chain.range = vi.fn();
  return { rpc: vi.fn(() => chain), order: chain.order, range: chain.range, from: vi.fn() };
});
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc, from }),
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getCashFlow } from "@/lib/services/supabase/analytics";

beforeEach(() => { rpc.mockClear(); from.mockClear(); order.mockClear(); range.mockReset(); });
describe("cash flow monthly summary", () => {
  it("uses scoped totals and keeps months and numeric amounts distinct", async () => {
    range.mockResolvedValue({ data: [
      {year: 2026, month: 8, type: "receipt", amount: "150000"},
      {year: 2026, month: 9, type: "payment", amount: "25000"},
    ], error: null });
    const rows = await getCashFlow(2, "branch-1", { from: "2026-08-01", to: "2026-09-30" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("get_cash_flow_created_month_totals", expect.objectContaining({
      p_branch: "branch-1", p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }));
    expect(rows).toEqual([{month:"T8/2026",thu:150000,chi:0,ton:150000},{month:"T9/2026",thu:0,chi:25000,ton:-25000}]);
  });
  it("surfaces a failed summary instead of displaying zero", async () => {
    range.mockResolvedValue({data:null,error:{message:"SUMMARY_UNAVAILABLE"}});
    await expect(getCashFlow(2, "branch-1", { from: "2026-08-01", to: "2026-09-30" })).rejects.toThrow("SUMMARY_UNAVAILABLE");
  });
});
