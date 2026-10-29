import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types";
import { getFnbMenuEstimates, selectMenuRecipe, sumMenuRecipeEstimate, sortByMenuEstimate, type RecipeHeader } from "@/lib/services/supabase/fnb-menu-estimates";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), tenant: vi.fn(), variants: vi.fn(), costs: vi.fn(),
}));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ from: mocks.from }), getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/services/supabase/variants", () => ({ getVariantsByProductIds: mocks.variants }));
vi.mock("@/lib/services/supabase/fnb-branch-cost", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/services/supabase/fnb-branch-cost")>(), getFnbBranchComponentCosts: mocks.costs }));

const product = { id: "tea", code: "SKU-TOL-006", channel: "fnb", hasBom: true, costPrice: 2685.62 } as Product;
const header = (id: string, branch: string | null, code: string | null = "TEA", version = 1): RecipeHeader => ({ id, branch_id: branch, code, version, product_id: "tea" });
const line = (id: string, quantity: number, price: number | null, prepared = false) => ({ quantity, products: { id, sell_price: price, is_fnb_stock_item: prepared } });
const balance = (productId: string, unitCost: number, costedQuantity = 100) => ({ productId, unitCost, costedQuantity, physicalQuantity: costedQuantity });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue("tenant-a");
  mocks.variants.mockResolvedValue(new Map());
  mocks.costs.mockResolvedValue(new Map([["prepared", balance("prepared", 12.09)]]));
});

describe("live menu recipe estimates", () => {
  it("prefers the local recipe then latest global version, never another branch", () => {
    const rows = [header("foreign", "other", "TEA", 99), header("global", null, "TEA", 4), header("local", "xtb", "TEA", 1)];
    expect(selectMenuRecipe(rows, "tea", "TEA", "xtb")?.id).toBe("local");
    expect(selectMenuRecipe(rows, "tea", "TEA", "new")?.id).toBe("global");
    expect(selectMenuRecipe(rows, "tea", "ORPHAN", "xtb")).toBeUndefined();
  });

  it("uses normalized stock quantities and branch costs for both purchased and prepared ingredients", () => {
    const lines = [line("cup", 0.02, 85000), line("prepared", 120, 999999, true)];
    const costs = new Map([["prepared", balance("prepared", 12.09)], ["cup", balance("cup", 80000)]]);
    expect(sumMenuRecipeEstimate(lines, costs)).toBeCloseTo(3050.8);
    costs.set("cup", balance("cup", 70000));
    expect(sumMenuRecipeEstimate(lines, costs)).toBeCloseTo(2850.8);
    costs.delete("cup");
    expect(sumMenuRecipeEstimate(lines, costs)).toBeNull();
  });

  it("never substitutes the old menu cost when BTP has no costed batch", () => {
    expect(sumMenuRecipeEstimate([line("prepared", 120, 999, true)], new Map())).toBeNull();
    expect(sumMenuRecipeEstimate([line("prepared", 120, 999, true)], new Map([["prepared", { ...balance("prepared", 12, 0), physicalQuantity: 100 }]]))).toBeNull();
    expect(sumMenuRecipeEstimate([line("prepared", 120, 999, true)], new Map([["prepared", balance("prepared", 0)]]))).toBe(0);
    expect(sumMenuRecipeEstimate([line("missing", 1, null)], new Map())).toBeNull();
    expect(sumMenuRecipeEstimate([], new Map())).toBeNull();
  });

  it("sorts the full matching set by current estimates and leaves unknown values last", () => {
    const others = [{ ...product, id: "high", code: "B", costPrice: 1 }, { ...product, id: "missing", code: "C" }];
    const estimates = new Map([["tea", { value: 6577.3 }], ["high", { value: 10000 }], ["missing", { value: null }]]);
    expect(sortByMenuEstimate([product, ...others], estimates, true).map((p) => p.id)).toEqual(["high", "tea", "missing"]);
    expect(product.costPrice).toBe(2685.62);
  });

  it("loads the default size's BOM and current BTP cost without any writes", async () => {
    mocks.variants.mockResolvedValue(new Map([["tea", [{ name: "Size L", isDefault: true, bomCode: "LARGE" }]]]));
    const eq = vi.fn();
    mocks.from.mockImplementation((table: string) => {
      const rows = table === "bom_scoped" ? [header("parent", null), header("large", "xtb", "LARGE")] : [{ bom_id: "large", ...line("prepared", 120, 999, true) }];
      const builder = { select: () => builder, eq: (...args: unknown[]) => { eq(...args); return builder; }, in: () => builder, order: () => builder, range: () => builder,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
      return builder;
    });
    const values = await getFnbMenuEstimates([product], "xtb");
    expect(values.get("tea")).toMatchObject({ value: 1450.8, variantName: "Size L" });
    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(mocks.costs).toHaveBeenCalledWith("xtb", ["prepared"]);
    expect(product.costPrice).toBe(2685.62);
    const allBranch = await getFnbMenuEstimates([product]);
    expect(allBranch.get("tea")?.value).toBeNull();
  });
});
