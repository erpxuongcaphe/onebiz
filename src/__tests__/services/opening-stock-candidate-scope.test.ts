import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ from: mocks.from }), getCurrentTenantId: async () => "tenant" }));
import { searchOpeningStockCandidates } from "@/lib/services/supabase/opening-stock";
function builder(data: unknown, error: unknown = null) {
  const q: any = { then: (resolve: any) => resolve({ data, error }) };
  for (const method of ["select", "eq", "or", "order", "limit", "single"]) q[method] = vi.fn(() => q);
  return q;
}
describe("opening stock receiving-branch scope", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["outlet", "production"])("uses the selected %s branch and applies eligibility before the limit", async mode => {
    const branch = builder({ cascade_mode: mode });
    const products = builder([{ id: "new", code: "SKU-NEW", name: "Chưa từng nhập", unit: "G" }]);
    mocks.from.mockImplementation(table => table === "branches" ? branch : products);
    await expect(searchOpeningStockCandidates("selected-branch", "trà")).resolves.toHaveLength(1);
    expect(branch.eq).toHaveBeenCalledWith("id", "selected-branch");
    expect(branch.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(products.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(products.or.mock.calls[0][0]).toContain(mode === "outlet" ? "product_type.eq.sku" : "has_bom.is.false");
    expect(products.or.mock.invocationCallOrder[0]).toBeLessThan(products.limit.mock.invocationCallOrder[0]);
    expect(mocks.from).not.toHaveBeenCalledWith("branch_stock");
  });
  it("does not widen the product search when the receiving branch cannot be read", async () => {
    mocks.from.mockReturnValue(builder(null, { message: "offline" }));
    await expect(searchOpeningStockCandidates("branch", "trà")).rejects.toThrow("Không đọc được chi nhánh");
    expect(mocks.from).not.toHaveBeenCalledWith("products_scoped");
  });
});
