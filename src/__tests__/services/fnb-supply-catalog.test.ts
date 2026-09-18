import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFnbSupplyBranchScope,
  listFnbSupplyCatalog,
  saveFnbSupplyCatalog,
  setFnbSupplyBranchScope,
} from "@/lib/services/supabase/fnb-supply-catalog";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => mocks,
  getCurrentTenantId: async () => "tenant-a",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));

describe("F&B supply catalog service", () => {
  beforeEach(() => vi.clearAllMocks());

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
