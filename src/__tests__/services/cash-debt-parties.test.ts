import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => m, handleError: (e: { message: string }) => { throw new Error(e.message); } }));
import { getCashDebtParties } from "@/lib/services/supabase/cash-debt-parties";

function page(kind: "customer" | "supplier", total: number, offset = 0, revision = "a".repeat(32), allowed = true) {
  return {
    revision, total,
    items: Array.from({ length: Math.min(200, Math.max(0, total - offset)) }, (_, i) => ({
      id: `party-${offset + i}`, code: `TEST-${offset + i}`, name: `Synthetic ${offset + i}`, phone: "",
      debt: allowed ? 100 : null, total_spent: null, total_purchases: null, returned_total: null, total_orders: null, last_purchase_at: null,
    })),
    summary: { scope: { scope: "branch", branchIds: ["branch-test"], activityBranchIds: [], debtBranchIds: allowed ? ["branch-test"] : [] }, canViewActivity: false, canViewDebt: allowed,
      totalDebt: allowed ? total * 100 : null,
      ...(kind === "customer" ? { totalSales: null, totalReturns: null, netSales: null, customersWithDebt: allowed ? total : null } : { totalPurchases: null, suppliersWithDebt: allowed ? total : null }) },
  };
}
beforeEach(() => { vi.resetAllMocks(); });
it("loads a complete picker beyond 1000 entries using normal scoped pages", async () => {
  m.rpc.mockImplementation(async (_: string, args: { p_page: number }) => ({ data: page("customer", 1001, args.p_page * 200), error: null }));
  const rows = await getCashDebtParties("customer", "branch-test");
  expect(rows).toHaveLength(1001); expect(rows[1000].id).toBe("party-1000");
  expect(m.rpc).toHaveBeenCalledTimes(6);
  for (const [name, args] of m.rpc.mock.calls) {
    expect(name).toBe("get_customer_list_workspace_scoped_v2");
    expect(args).toMatchObject({ p_branch_id: "branch-test", p_page_size: 200, p_debt_filter: "has_debt", p_for_export: false });
  }
  expect(m.from).not.toHaveBeenCalled();
});
it("filters nonpositive and internal supplier entries without changing positive amounts", async () => {
  const payload = page("supplier", 3);
  payload.items[0].debt = 125;
  payload.items[1].debt = 0;
  const internal = { ...payload.items[2], is_internal: true };
  payload.items[2] = internal;
  m.rpc.mockResolvedValue({ data: payload, error: null });
  expect(await getCashDebtParties("supplier", "branch-test")).toEqual([{ id: "party-0", code: "TEST-0", name: "Synthetic 0", debt: 125 }]);
  expect(m.rpc).toHaveBeenCalledWith("get_supplier_list_workspace_scoped_v2", expect.objectContaining({ p_branch_id: "branch-test", p_debt_min: 0, p_for_export: false }));
});
it("does not treat a masked balance as zero", async () => {
  m.rpc.mockResolvedValue({ data: page("customer", 0, 0, "a".repeat(32), false), error: null });
  await expect(getCashDebtParties("customer", "branch-test")).rejects.toThrow("Chưa được cấp quyền");
});
it("rejects changed page revisions rather than mixing a partial picker", async () => {
  m.rpc.mockImplementation(async (_: string, args: { p_page: number }) => ({ data: page("customer", 201, args.p_page * 200, (args.p_page ? "b" : "a").repeat(32)), error: null }));
  await expect(getCashDebtParties("customer", "branch-test")).rejects.toThrow("PARTY_DIRECTORY_CHANGED_DURING_READ");
});
it("does not query without a branch or after cancellation", async () => {
  await expect(getCashDebtParties("supplier", " ")).rejects.toThrow("Chọn một chi nhánh");
  const c = new AbortController(); c.abort();
  await expect(getCashDebtParties("customer", "branch-test", c.signal)).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled();
});
