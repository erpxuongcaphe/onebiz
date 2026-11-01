import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types";
import { getFnbPreparedRecipeEstimates } from "@/lib/services/supabase/fnb-menu-estimates";
import { getFnbMenuEstimates, getMenuCostIssues, selectMenuRecipe, sumMenuRecipeEstimate, sumMenuRecipePreview, sortByMenuEstimate, type RecipeHeader } from "@/lib/services/supabase/fnb-menu-estimates";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), tenant: vi.fn(), variants: vi.fn(), costs: vi.fn(), units: vi.fn(),
}));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ from: mocks.from }), getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/services/supabase/variants", () => ({ getVariantsByProductIds: mocks.variants }));
vi.mock("@/lib/services/supabase/uom", () => ({ getUOMConversionsByProductIds: mocks.units }));
vi.mock("@/lib/services/supabase/fnb-branch-cost", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/services/supabase/fnb-branch-cost")>(), getFnbBranchComponentCosts: mocks.costs }));

const product = { id: "tea", code: "SKU-TOL-006", channel: "fnb", hasBom: true, costPrice: 2685.62 } as Product;
const header = (id: string, branch: string | null, code: string | null = "TEA", version = 1): RecipeHeader => ({ id, branch_id: branch, code, version, product_id: "tea", yield_qty: 1, yield_unit: "G" });
const line = (id: string, quantity: number, price: number | null, prepared = false) => ({ quantity, products: { id, sell_price: price, is_fnb_stock_item: prepared } });
const balance = (productId: string, unitCost: number, costedQuantity = 100) => ({ productId, unitCost, costedQuantity, physicalQuantity: costedQuantity });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue("tenant-a");
  mocks.variants.mockResolvedValue(new Map());
  mocks.units.mockResolvedValue(new Map());
  mocks.costs.mockResolvedValue(new Map([["prepared", balance("prepared", 12.09)]]));
});

describe("live menu recipe estimates", () => {
  it("sorts prepared goods by displayed branch cost instead of the shared catalog price", () => {
    const prepared = { ...product, id: "prepared", code: "BTP", isFnbStockItem: true, costPrice: 999 };
    const menu = { ...product, id: "menu", code: "MENU" };
    const missing = { ...prepared, id: "missing", code: "UNKNOWN", costPrice: 0 };
    const estimates = new Map([["menu", { value: 20 }]]);
    expect(sortByMenuEstimate([missing, prepared, menu], estimates, false, new Map([["prepared", 10]])).map(row => row.id)).toEqual(["prepared", "menu", "missing"]);
    expect(sortByMenuEstimate([missing, prepared, menu], estimates, true, new Map([["prepared", 10]])).map(row => row.id)).toEqual(["menu", "prepared", "missing"]);
  });
  it("normalizes prepared root output, refreshes prices and rejects unknown conversion without changing balances", async () => {
    const root = { ...product, unit: "G", isFnbStockItem: true, bomCode: "ROOT" };
    const recipe = { ...header("root-bom", "xtb", "ROOT"), yield_qty: 2, yield_unit: "Kg" };
    const raw = { id: "raw", unit: "G", is_fnb_stock_item: false };
    const rows = [{ bom_id: "root-bom", quantity: 1000, waste_percent: 10, products: raw }];
    mocks.from.mockImplementation((table: string) => {
      let filtered: unknown[] = table === "bom_scoped" ? [recipe] : rows;
      const builder = { select: () => builder, eq: () => builder, order: () => builder,
        in: (field: string, values: string[]) => { filtered = filtered.filter(row => values.includes(String((row as Record<string, unknown>)[field]))); return builder; },
        range: () => builder, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: filtered, error: null }).then(resolve) };
      return builder;
    });
    const prices = new Map([["raw", balance("raw", 2)]]);
    mocks.costs.mockResolvedValue(prices);
    expect((await getFnbPreparedRecipeEstimates([root], "xtb")).has("tea")).toBe(false);
    mocks.units.mockResolvedValue(new Map([["tea", [{ fromUnit: "Kg", toUnit: "G", factor: 1000, isActive: true }]]]));
    expect((await getFnbPreparedRecipeEstimates([root], "xtb")).get("tea")).toBeCloseTo(1.1);
    expect(mocks.variants).not.toHaveBeenCalled();
    prices.set("raw", balance("raw", 4));
    expect((await getFnbPreparedRecipeEstimates([root], "xtb")).get("tea")).toBeCloseTo(2.2);
    expect(prices.get("raw")).toEqual(balance("raw", 4));
    prices.set("raw", balance("raw", 0));
    expect((await getFnbPreparedRecipeEstimates([root], "xtb")).get("tea")).toBe(0);
    prices.clear();
    expect((await getFnbPreparedRecipeEstimates([root], "xtb")).has("tea")).toBe(false);
    recipe.branch_id = "other-branch";
    prices.set("raw", balance("raw", 4));
    expect((await getFnbPreparedRecipeEstimates([root], "xtb")).has("tea")).toBe(false);
    const calls = mocks.from.mock.calls.length;
    expect((await getFnbPreparedRecipeEstimates([root])).size).toBe(0);
    expect(mocks.from.mock.calls.length).toBe(calls);
  });

  it("loads nested branch recipes and refreshes leaf prices without requiring a prepared batch", async () => {
    const menuHeader: RecipeHeader = { ...header("drink-bom", null, "DRINK"), yield_qty: 1, yield_unit: "cái" };
    const preparedHeader = { ...header("prepared-bom", "xtb", "PREP"), product_id: "prepared", yield_qty: 200, yield_unit: "G" };
    const preparedMaterial = { id: "prepared", code: "BTP-TEST", name: "Prepared test", unit: "G", bom_code: "PREP", sell_price: 999999, is_fnb_stock_item: true };
    const rows = [
      { bom_id: "drink-bom", quantity: 30, waste_percent: 0, products: preparedMaterial },
      { bom_id: "prepared-bom", quantity: 100, waste_percent: 0, products: { id: "raw", unit: "G", sell_price: 999999, is_fnb_stock_item: false } },
    ];
    mocks.from.mockImplementation((table: string) => {
      let filtered: unknown[] = table === "bom_scoped" ? [menuHeader, preparedHeader] : rows;
      const builder = { select: () => builder, eq: () => builder, order: () => builder,
        in: (field: string, values: string[]) => { filtered = filtered.filter(row => values.includes(String((row as unknown as Record<string, unknown>)[field]))); return builder; },
        range: () => builder, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: filtered, error: null }).then(resolve) };
      return builder;
    });
    const costs = new Map([["raw", balance("raw", 20)], ["prepared", { ...balance("prepared", 0, 0), physicalQuantity: -30 }]]);
    mocks.costs.mockResolvedValue(costs);
    const menu = { ...product, unit: "Ly" };
    const first = (await getFnbMenuEstimates([menu], "xtb")).get("tea");
    expect(first?.value).toBe(300);
    expect(mocks.costs).toHaveBeenCalledWith("xtb", ["prepared", "raw"]);
    expect(first?.reason).toBeUndefined();
    const preparedRoot = { ...menu, unit: "G", isFnbStockItem: true };
    menuHeader.yield_unit = "G";
    menuHeader.yield_qty = 100;
    expect((await getFnbPreparedRecipeEstimates([preparedRoot], "xtb")).get("tea")).toBe(3);
    expect((await getFnbPreparedRecipeEstimates([preparedRoot])).size).toBe(0);
    menuHeader.yield_qty = 1;
    menuHeader.yield_unit = "cái";
    expect(first?.issues).toEqual([expect.objectContaining({ code: "BTP-TEST", reason: "negative_stock" })]);
    menuHeader.yield_qty = null;
    expect((await getFnbMenuEstimates([menu], "xtb")).get("tea")?.value).toBeNull();
    menuHeader.yield_qty = 1;
    costs.set("raw", balance("raw", 24));
    expect((await getFnbMenuEstimates([menu], "xtb")).get("tea")?.value).toBe(360);
    preparedHeader.yield_qty = 2;
    preparedHeader.yield_unit = "Kg";
    expect((await getFnbMenuEstimates([menu], "xtb")).get("tea")?.value).toBeNull();
    mocks.units.mockResolvedValue(new Map([["prepared", [{ fromUnit: "Kg", toUnit: "G", factor: 1000, isActive: true }]]]));
    expect((await getFnbMenuEstimates([menu], "xtb")).get("tea")?.value).toBe(36);
    preparedHeader.code = "OTHER-RECIPE";
    costs.set("prepared", balance("prepared", 99));
    expect((await getFnbMenuEstimates([menu], "xtb")).get("tea")).toMatchObject({ value: null, issues: expect.arrayContaining([expect.objectContaining({ reason: "invalid_recipe" })]) });
    preparedHeader.code = "PREP";
    rows[1].products = preparedMaterial;
    expect((await getFnbMenuEstimates([menu], "xtb")).get("tea")).toMatchObject({ value: null, issues: expect.arrayContaining([expect.objectContaining({ reason: "recipe_cycle" })]) });
  });

  it("keeps a sourced current formula preview while the posting cost remains unresolved", () => {
    const costs = new Map([["syrup", { ...balance("syrup", 20, 0), physicalQuantity: -100 }]]);
    const lines = [line("syrup", 30, 99999, true)];
    expect(sumMenuRecipePreview(lines, costs)).toBe(600);
    expect(sumMenuRecipeEstimate(lines, costs)).toBeNull();
    expect(getMenuCostIssues(lines, costs)[0].reason).toBe("negative_stock");
    expect(sumMenuRecipePreview(lines, new Map())).toBeNull();
    costs.set("syrup", { ...balance("syrup", 0, 0), physicalQuantity: -100 });
    expect(sumMenuRecipePreview(lines, costs)).toBeNull();
  });

  it("identifies the affected component without substituting its saved price", () => {
    const lines = [{ ...line("syrup", 26, 999, true), products: { ...line("syrup", 26, 999, true).products, code: "BTP-TEST", name: "Test syrup", unit: "G" } }];
    const costs = new Map([["syrup", { ...balance("syrup", 16, 0), physicalQuantity: -100 }]]);
    expect(getMenuCostIssues(lines, costs)).toEqual([expect.objectContaining({ code: "BTP-TEST", reason: "negative_stock", physicalQuantity: -100, costedQuantity: 0, unit: "G" })]);
    expect(sumMenuRecipeEstimate(lines, costs)).toBeNull();
    expect(costs.get("syrup")?.unitCost).toBe(16);
  });

  it("separates missing prices, quantity mismatches and invalid data", () => {
    const lines = [line("missing", 1, null), line("mismatch", 1, null), line("invalid", 1, null), line("free", 1, null), line("unused", 0, null)];
    const costs = new Map([
      ["mismatch", { ...balance("mismatch", 10, 5), physicalQuantity: 8 }],
      ["invalid", balance("invalid", Number.NaN)],
      ["free", balance("free", 0)],
    ]);
    expect(getMenuCostIssues(lines, costs).map(issue => [issue.componentId, issue.reason])).toEqual([
      ["missing", "missing_cost"], ["mismatch", "quantity_mismatch"], ["invalid", "invalid_cost"],
    ]);
    expect(getMenuCostIssues([{ quantity: 1, products: null }, line("bad", -1, null)], costs).map(issue => issue.reason))
      .toEqual(["missing_component", "invalid_quantity"]);
  });

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
    const costReadsBeforeAll = mocks.costs.mock.calls.length;
    const allBranch = await getFnbMenuEstimates([product]);
    expect(allBranch.get("tea")?.value).toBeNull();
    expect(allBranch.get("tea")?.issues).toEqual([]);
    expect(mocks.costs.mock.calls.length).toBe(costReadsBeforeAll);
  });
});
