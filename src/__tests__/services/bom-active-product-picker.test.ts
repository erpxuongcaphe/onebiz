import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mocks.from }),
  getCurrentTenantId: mocks.tenant,
}));
import { getAllBOMs } from "@/lib/services/supabase/bom";

function query(data: unknown[] = [], error: unknown = null) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), in: vi.fn(),
    then: (resolve: (value: { data: unknown[]; error: unknown }) => unknown) => resolve({ data, error }),
  };
  for (const method of [builder.select, builder.eq, builder.order, builder.in]) method.mockReturnValue(builder);
  return builder;
}

beforeEach(() => { vi.clearAllMocks(); mocks.tenant.mockResolvedValue("tenant"); });

describe("active product filter for new production orders", () => {
  it("requires an active output through an inner join and preserves tenant/BOM guards", async () => {
    const builder = query();
    mocks.from.mockReturnValue(builder);
    await getAllBOMs({ activeProductsOnly: true });
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("products!bom_product_id_fkey!inner("));
    expect(builder.eq).toHaveBeenCalledWith("products.is_active", true);
    expect(builder.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("does not remove inactive products from existing formula/history reads", async () => {
    const builder = query();
    mocks.from.mockReturnValue(builder);
    await getAllBOMs();
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("products!bom_product_id_fkey("));
    expect(builder.eq).not.toHaveBeenCalledWith("products.is_active", true);
  });

  it("keeps the branch-history filter compatible with the opt-in product filter", async () => {
    const builder = query();
    const orders = query([{ bom_id: "bom" }]);
    mocks.from.mockImplementation((table: string) => table === "production_orders" ? orders : builder);
    await getAllBOMs({ activeProductsOnly: true, usedAtBranchId: "xtb" });
    expect(orders.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(orders.eq).toHaveBeenCalledWith("branch_id", "xtb");
    expect(builder.in).toHaveBeenCalledWith("id", ["bom"]);
    expect(builder.eq).toHaveBeenCalledWith("products.is_active", true);
  });

  it("surfaces a query failure instead of treating it as an empty catalog", async () => {
    mocks.from.mockReturnValue(query([], new Error("catalog read failed")));
    await expect(getAllBOMs({ activeProductsOnly: true })).rejects.toThrow("catalog read failed");
  });
});
