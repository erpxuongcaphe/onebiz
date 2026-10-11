import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mocks.from }),
  getCurrentTenantId: mocks.tenant,
}));
import { getAllBOMs, getBOMsByProduct } from "@/lib/services/supabase/bom";
import { filterProductionOutputBoms } from "@/lib/production-output-scope";

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
  it("retains prepared-product metadata when loading its shared recipe", async () => {
    const recipes = query([{ id: "recipe", product_id: null, code: "BOM-COLD", is_active: true, yield_qty: 600, yield_unit: "G" }]);
    (recipes as any).or = vi.fn().mockReturnValue(recipes);
    const sku = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: {
      bom_code: "BOM-COLD", name: "Cold Brew", code: "BTP-COLD", channel: "fnb", is_fnb_stock_item: true,
    }, error: null }) };
    sku.select.mockReturnValue(sku); sku.eq.mockReturnValue(sku);
    mocks.from.mockImplementation((table: string) => table === "products_scoped" ? sku : recipes);
    const loaded = await getBOMsByProduct("prepared");
    expect(filterProductionOutputBoms(loaded, "xtb", "outlet")).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ isFnbStockItem: true, productName: "Cold Brew", yieldQty: 600 });
  });
  it("requires an active output through an inner join and preserves tenant/BOM guards", async () => {
    const builder = query();
    mocks.from.mockReturnValue(builder);
    await getAllBOMs({ activeProductsOnly: true });
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("products:products_scoped!bom_product_id_fkey!inner("));
    expect(builder.eq).toHaveBeenCalledWith("products.is_active", true);
    expect(builder.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("does not remove inactive products from existing formula/history reads", async () => {
    const builder = query();
    mocks.from.mockReturnValue(builder);
    await getAllBOMs();
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("products:products_scoped!bom_product_id_fkey("));
    expect(builder.eq).not.toHaveBeenCalledWith("products.is_active", true);
  });

  it("keeps the branch-history filter compatible with the opt-in product filter", async () => {
    const builder = query();
    const orders = query([{ bom_id: "bom_scoped" }]);
    mocks.from.mockImplementation((table: string) => table === "production_orders_scoped" ? orders : builder);
    await getAllBOMs({ activeProductsOnly: true, usedAtBranchId: "xtb" });
    expect(orders.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(orders.eq).toHaveBeenCalledWith("branch_id", "xtb");
    expect(builder.in).toHaveBeenCalledWith("id", ["bom_scoped"]);
    expect(builder.eq).toHaveBeenCalledWith("products.is_active", true);
  });

  it("surfaces a query failure instead of treating it as an empty catalog", async () => {
    mocks.from.mockReturnValue(query([], new Error("catalog read failed")));
    await expect(getAllBOMs({ activeProductsOnly: true })).rejects.toThrow("catalog read failed");
  });
});
