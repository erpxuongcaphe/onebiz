import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => api,
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getScopedCustomerDirectory, getScopedSupplierDirectory } from "@/lib/services/supabase/party-directory-workspace";

const empty = (kind: "customer" | "supplier", branchId: string | null = "branch-a") => ({
  revision: "a".repeat(32), total: 0, items: [], summary: {
    scope: { scope: branchId ? "branch" : "assigned", branchIds: branchId ? [branchId] : ["branch-a"] },
    canViewActivity: false, canViewDebt: false, totalDebt: null,
    ...(kind === "customer" ? { totalSales: null, totalReturns: null, netSales: null, customersWithDebt: null }
      : { totalPurchases: null, suppliersWithDebt: null }),
  },
});
beforeEach(() => { vi.resetAllMocks(); });
describe("staged scoped directory workspace", () => {
  it("preserves customer filters and branch in one scoped request", async () => {
    api.rpc.mockResolvedValue({ data: empty("customer"), error: null });
    await getScopedCustomerDirectory({ branchId: "branch-a", page: 0, pageSize: 15,
      search: " Customer ", searchField: "name", groupIds: ["group-a"], customerType: "company", gender: "female",
      debtFilter: "has_debt", salesRange: "tier_vip", ordersRange: "frequent", lastPurchase: "month",
      birthdayMonth: "10", tags: ["VIP"], province: "Dong Nai", dateFrom: "2026-10-01", dateTo: "2026-10-24" });
    expect(api.rpc).toHaveBeenCalledWith("get_customer_list_workspace_scoped", {
      p_branch_id: "branch-a", p_page: 0, p_page_size: 15, p_for_export: false,
      p_sort_by: "createdAt", p_sort_desc: true,
      p_search: "Customer", p_search_field: "name", p_group_ids: ["group-a"], p_customer_type: "company", p_gender: "female",
      p_debt_filter: "has_debt", p_sales_range: "tier_vip", p_orders_range: "frequent", p_last_purchase: "month",
      p_birthday_month: 10, p_tags: ["VIP"], p_province: "Dong Nai",
      p_created_from: "2026-09-30T17:00:00.000Z", p_created_to_exclusive: "2026-10-24T17:00:00.000Z",
    });
    expect(api.from).not.toHaveBeenCalled();
  });
  it("preserves supplier range filters including negative credit balances", async () => {
    api.rpc.mockResolvedValue({ data: empty("supplier", null), error: null });
    await getScopedSupplierDirectory({ branchId: null, page: 0, pageSize: 15, statuses: ["active"],
      debtFrom: "-100", debtTo: "0", totalPurchaseFrom: "0", totalPurchaseTo: "900" });
    expect(api.rpc).toHaveBeenCalledWith("get_supplier_list_workspace_scoped", expect.objectContaining({
      p_branch_id: null, p_statuses: ["active"], p_debt_min: -100, p_debt_max: 0,
      p_total_purchase_min: 0, p_total_purchase_max: 900,
    }));
  });
  it("passes the selected sort to both list and full export requests", async () => {
    api.rpc.mockResolvedValue({ data: empty("supplier"), error: null });
    for (const exportAll of [false, true]) {
      await getScopedSupplierDirectory({ branchId: "branch-a", page: 0, pageSize: 15, sortBy: "totalPurchases", sortDesc: false }, { exportAll });
      expect(api.rpc).toHaveBeenLastCalledWith("get_supplier_list_workspace_scoped", expect.objectContaining({ p_sort_by: "totalPurchases", p_sort_desc: false, p_for_export: exportAll }));
    }
  });
  it("rejects unsupported sort keys before making a request", () => {
    expect(() => getScopedCustomerDirectory({ branchId: null, page: 0, pageSize: 15, sortBy: "unit_cost" })).toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it.each(["permission denied", "function unavailable"])("does not fall back to shared table/cache: %s", async message => {
    api.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(getScopedCustomerDirectory({ branchId: "branch-a", page: 0, pageSize: 15 })).rejects.toThrow(message);
    expect(api.rpc).toHaveBeenCalledTimes(1); expect(api.from).not.toHaveBeenCalled();
  });
  it("rejects a response from a previously selected branch", async () => {
    api.rpc.mockResolvedValue({ data: empty("customer", "branch-b"), error: null });
    await expect(getScopedCustomerDirectory({ branchId: "branch-a", page: 0, pageSize: 15 })).rejects.toThrow();
  });
  it("uses the export permission path, not a normal list request", async () => {
    api.rpc.mockResolvedValue({ data: empty("supplier"), error: null });
    await getScopedSupplierDirectory({ branchId: "branch-a", page: 4, pageSize: 15 }, { exportAll: true });
    expect(api.rpc).toHaveBeenCalledWith("get_supplier_list_workspace_scoped", expect.objectContaining({
      p_page: 0, p_page_size: 200, p_for_export: true,
    }));
  });
  it.each([{ debtFrom: "NaN" }, { debtFrom: "100", debtTo: "50" }, { dateFrom: "2026-02-30" },
    { dateFrom: "2026-10-24", dateTo: "2026-10-01" }])("rejects invalid filters before reading %j", filters => {
    expect(() => getScopedSupplierDirectory({ branchId: "branch-a", page: 0, pageSize: 15, ...filters })).toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it("does not query an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getScopedCustomerDirectory({ branchId: "branch-a", page: 0, pageSize: 15 }, { signal: controller.signal })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
