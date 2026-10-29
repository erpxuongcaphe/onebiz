import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getSkuFinancialReport } from "@/lib/services/supabase/sku-financial-report";

const range = { from: "2026-10-01", to: "2026-10-29" };
beforeEach(() => rpc.mockReset());
describe("SKU report filter source contract", () => {
  it.each([null, {}, { rows: [] }, { customers: [] }, { rows: {}, customers: [] }])("rejects an incomplete payload instead of inventing empty filters: %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getSkuFinancialReport(range, "branch-a", "customer-a")).rejects.toThrow("Chưa nhận đủ dữ liệu");
  });
  it("keeps a confirmed empty report distinct from a failed source", async () => {
    rpc.mockResolvedValue({ data: { rows: [], customers: [] }, error: null });
    expect(await getSkuFinancialReport(range, "branch-a", "customer-a")).toEqual({ rows: [], customers: [] });
    expect(rpc).toHaveBeenCalledWith("get_sku_financial_report", expect.objectContaining({ p_branch_id: "branch-a", p_customer_id: "customer-a" }));
  });
  it.each([null, {}, { product_id: "TEST", sales_amount: 100 }])("rejects a partial row instead of displaying zero totals: %j", async row => {
    rpc.mockResolvedValue({ data: { rows: [row], customers: [] }, error: null });
    await expect(getSkuFinancialReport(range)).rejects.toThrow();
  });
  it("propagates access denial without falling back to a shared directory", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "REPORT_BRANCH_DENIED" } });
    await expect(getSkuFinancialReport(range, "other-branch")).rejects.toThrow("REPORT_BRANCH_DENIED");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
