import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFnbSupplyBranchScope,
  listFnbSupplyCatalog,
  listFnbSupplyBomSuggestions,
  listFnbSupplyCatalogProductIds,
  saveFnbSupplyCatalog,
  setFnbSupplyBranchScope,
} from "@/lib/services/supabase/fnb-supply-catalog";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), menuScopes: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => mocks,
  getCurrentTenantId: async () => "tenant-a",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
vi.mock("@/lib/services/supabase/fnb-product-branch-menu", () => ({
  filterFnbProductsForBranch: <T extends { id: string }>(
    products: T[],
    scopes: Array<{ productId: string; branchId: string; mode: "only" | "except" }>,
    branchId: string,
  ) => products.filter((product) => {
    const scope = scopes.find((item) => item.productId === product.id);
    return !scope || (scope.mode === "only" ? scope.branchId === branchId : scope.branchId !== branchId);
  }),
  listFnbProductBranchMenuScopes: mocks.menuScopes,
}));

describe("F&B supply catalog service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.menuScopes.mockResolvedValue([]);
  });

  it("deduplicates explicit assignments and only calls the configuration RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    expect(await saveFnbSupplyCatalog(["box", "box"], ["branch-a", "branch-b", "branch-a"], "add")).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_fnb_supply_catalog", {
      p_product_ids: ["box"], p_branch_ids: ["branch-a", "branch-b"], p_action: "add",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not submit empty assignments", async () => {
    await expect(saveFnbSupplyCatalog([], ["branch-a"], "add")).rejects.toThrow();
    await expect(saveFnbSupplyCatalog(["box"], [], "add")).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("removes only selected SKU and branch, without resetting the whole catalog", async () => {
    mocks.rpc.mockResolvedValue({ data: 1 });
    await saveFnbSupplyCatalog(["box"], ["branch-a"], "remove");
    expect(mocks.rpc).toHaveBeenCalledWith("save_fnb_supply_catalog", {
      p_product_ids: ["box"], p_branch_ids: ["branch-a"], p_action: "remove",
    });
  });

  it("propagates permission failures", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "FNB_SUPPLY_PERMISSION_DENIED" } });
    await expect(saveFnbSupplyCatalog(["box"], ["branch-a"], "add")).rejects.toThrow("FNB_SUPPLY_PERMISSION_DENIED");
  });

  it("paginates deterministically within the requested tenant and branch", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 42 }).then(resolve),
    };
    mocks.from.mockReturnValue(query);
    expect(await listFnbSupplyCatalog("branch-b", 1)).toEqual({ rows: [], count: 42 });
    expect(mocks.from).toHaveBeenCalledWith("fnb_supply_catalog");
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(query.eq).toHaveBeenCalledWith("branch_id", "branch-b");
    expect(query.range).toHaveBeenCalledWith(30, 59);
    expect(query.order).toHaveBeenCalledWith("product_id");
  });

  it("loads only exact catalog IDs for an enabled outlet picker", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: [{ product_id: "box" }, { product_id: "box" }, { product_id: "carton" }], error: null,
      }).then(resolve),
    };
    mocks.from.mockReturnValue(query);
    await expect(listFnbSupplyCatalogProductIds("branch-a")).resolves.toEqual(["box", "carton"]);
    expect(mocks.from).toHaveBeenCalledWith("fnb_supply_catalog");
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(query.eq).toHaveBeenCalledWith("branch_id", "branch-a");
    expect(query.limit).toHaveBeenCalledWith(1000);
  });

  it("suggests only unassigned Retail SKU components from active F&B BOMs", async () => {
    const makeQuery = (result: unknown) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "fnb_supply_catalog") return makeQuery({ data: [{ product_id: "already" }], error: null });
      if (table === "bom") return makeQuery({ data: [{ id: "bom-1" }], error: null });
      if (table === "bom_items") return makeQuery({ data: [{ material_id: "already" }, { material_id: "box" }], error: null });
      if (table === "products") {
        const callCount = mocks.from.mock.calls.filter((call) => call[0] === "products").length;
        return callCount === 1
          ? makeQuery({ data: [{ id: "menu-1" }], error: null })
          : makeQuery({ data: [{ id: "box", code: "SKU-BOX", name: "Hộp sữa", unit: "Hộp" }], error: null });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(listFnbSupplyBomSuggestions("branch-a")).resolves.toEqual([
      { id: "box", code: "SKU-BOX", name: "Hộp sữa", unit: "Hộp" },
    ]);
  });

  it("suggests only the BOM components used by the selected outlet menu and its applicable BOM", async () => {
    const bomQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "bom-a" }], error: null }).then(resolve),
    };
    const query = (result: unknown) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    });
    mocks.menuScopes.mockResolvedValue([{ productId: "hidden-menu", branchId: "other-store", mode: "only" }]);
    mocks.from.mockImplementation((table: string) => {
      if (table === "fnb_supply_catalog") return query({ data: [], error: null });
      if (table === "bom") return bomQuery;
      if (table === "bom_items") return query({ data: [{ material_id: "box" }], error: null });
      if (table === "products") {
        const calls = mocks.from.mock.calls.filter((call) => call[0] === "products").length;
        return calls === 1
          ? query({ data: [{ id: "visible-menu" }, { id: "hidden-menu" }], error: null })
          : query({ data: [{ id: "box", code: "SKU-SUA-001", name: "Sữa hộp", unit: "Hộp" }], error: null });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await listFnbSupplyBomSuggestions("branch-a");
    expect(bomQuery.in).toHaveBeenCalledWith("product_id", ["visible-menu"]);
    expect(bomQuery.or).toHaveBeenCalledWith("branch_id.eq.branch-a,branch_id.is.null");
  });

  it("reads missing opt-in scope as disabled", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mocks.from.mockReturnValue(query);
    await expect(getFnbSupplyBranchScope("branch-a")).resolves.toEqual({ enforcementEnabled: false });
    expect(mocks.from).toHaveBeenCalledWith("fnb_supply_branch_scopes");
  });

  it("changes enforcement through the dedicated RPC only", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(setFnbSupplyBranchScope("branch-a", true)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("set_fnb_supply_branch_enforcement", {
      p_branch_id: "branch-a", p_enabled: true, p_note: null,
    });
  });
});
