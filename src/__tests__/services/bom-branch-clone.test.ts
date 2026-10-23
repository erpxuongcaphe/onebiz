import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => mocks, getCurrentTenantId: async () => "tenant" }));
import { cloneBOMForBranch } from "@/lib/services/supabase/bom";
beforeEach(() => vi.clearAllMocks());
describe("Complete branch BOM copy", () => {
  it("uses one atomic RPC and returns the created branch recipe without client-side writes or a second read", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "copy", tenant_id: "tenant", code: "BOM-M", product_id: "drink", variant_id: "size-m", branch_id: "premium", name: "Drink M (Premium)", branches: { name: "Premium" }, yield_qty: 1, yield_unit: "Ly" }, error: null });
    const result = await cloneBOMForBranch("global", "premium");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("clone_bom_for_branch_atomic", { p_source_bom_id: "global", p_target_branch_id: "premium" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: "copy", code: "BOM-M", branchId: "premium", variantId: "size-m", branchName: "Premium", yieldQty: 1 });
  });
  it.each([
    ["BOM_CLONE_TARGET_EXISTS", "không ghi đè"],
    ["FNB_EXACT_RECIPE_OPTION_TENANT_MISMATCH", "không còn hoạt động"],
    ["BOM_CLONE_UOM_CHANGED", "quy đổi"],
    ["BOM_CLONE_LINK_MISMATCH", "món/size"],
    ["BOM_CLONE_PERMISSION_DENIED", "quyền"],
    ["BOM_CLONE_BRANCH_DENIED", "phân quyền"],
  ])("reports %s without attempting fallback writes", async (message, visible) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(cloneBOMForBranch("global", "premium")).rejects.toThrow(visible);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not report success for an unconfirmed response", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(cloneBOMForBranch("global", "premium")).rejects.toThrow("xác nhận");
  });
});
