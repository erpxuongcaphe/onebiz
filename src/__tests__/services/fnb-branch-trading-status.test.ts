import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ rpc: mock.rpc, from: (table: string) => {
    const builder = { select: () => builder, eq: () => builder, order: () => builder,
      range: async (from: number, to: number) => ({ data: mock.tables[table].slice(from, to + 1), count: mock.tables[table].length, error: null }) };
    return builder;
  } }),
}));
import { filterFnbProductsForBranch, getFnbMenuScopeFingerprint, getFnbProductBranchMenuPolicy, getFnbUnavailableProductIds, listFnbProductBranchMenuScopes } from "@/lib/services/supabase/fnb-product-branch-menu";
import { setProductTradingStatus } from "@/lib/services/supabase/product-trading-status";
beforeEach(() => {
  mock.tables = { fnb_product_branch_menu_scopes: [], fnb_product_branch_menu_policies: [] };
  mock.rpc.mockReset().mockResolvedValue({ data: 2, error: null });
});
describe("branch trading menu and POS", () => {
  it("reads beyond a page and keeps an empty ONLY policy closed at all outlets", async () => {
    mock.tables.fnb_product_branch_menu_scopes = Array.from({ length: 260 }, (_, n) => ({ id: String(n), product_id: `p${n}`, branch_id: "xtb" }));
    mock.tables.fnb_product_branch_menu_policies = [
      ...Array.from({ length: 260 }, (_, n) => ({ id: String(n), product_id: `p${n}`, mode: "only" })),
      { id: "empty", product_id: "empty", mode: "only" },
    ];
    const scopes = await listFnbProductBranchMenuScopes("tenant");
    expect(scopes).toHaveLength(261);
    const products = [{ id: "p259" }, { id: "empty" }, { id: "shared" }];
    expect(filterFnbProductsForBranch(products, scopes, "xtb").map(p => p.id)).toEqual(["p259", "shared"]);
    expect(filterFnbProductsForBranch(products, scopes, "premium").map(p => p.id)).toEqual(["shared"]);
    expect(getFnbUnavailableProductIds(scopes, "xtb")).toEqual(["empty"]);
    expect(await getFnbProductBranchMenuPolicy("empty")).toEqual({ mode: "only", branchIds: [] });
    expect(getFnbMenuScopeFingerprint(scopes)).not.toBe(getFnbMenuScopeFingerprint(scopes.filter(s => s.productId !== "empty")));
  });
  it("passes selected branch once for cross-page bulk, never to the global RPC", async () => {
    await setProductTradingStatus(["p", "q", "p"], false, "premium");
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("set_fnb_branch_trading_status_20261025", { p_ids: ["p", "q"], p_active: false, p_branch_id: "premium" });
  });
  it("preserves the existing Retail RPC and rejects an unconfirmed response", async () => {
    await setProductTradingStatus(["retail"], true);
    expect(mock.rpc).toHaveBeenCalledWith("set_product_trading_status_00559", { p_ids: ["retail"], p_active: true });
    mock.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(setProductTradingStatus(["p"], true, "premium")).rejects.toThrow("Chưa xác nhận");
  });
});
