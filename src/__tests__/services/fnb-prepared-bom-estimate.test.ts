import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFnbPreparedBomEstimates } from "@/lib/services/supabase/bom";

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  costs: vi.fn(),
  products: [] as Array<{ id: string; bom_code: string | null }>,
  bom: [] as Array<{ id: string; product_id: string | null; code: string; branch_id: string | null; version: number; yield_qty: number }>,
  items: [] as Array<{ bom_id: string; quantity: number; waste_percent: number; products: { id: string; sell_price: number; is_fnb_stock_item: boolean } | null }>,
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mock.from }),
  getCurrentTenantId: async () => "tenant-a",
}));

vi.mock("@/lib/services/supabase/fnb-branch-cost", async (original) => ({
  ...await original<typeof import("@/lib/services/supabase/fnb-branch-cost")>(),
  getFnbBranchComponentCosts: mock.costs,
}));

describe("prepared F&B BOM estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.costs.mockResolvedValue(new Map([["coffee", {productId:"coffee",unitCost:180000,costedQuantity:5,physicalQuantity:5}]]));
    mock.products = [{ id: "cold-brew", bom_code: null }];
    mock.bom = [{ id: "recipe", product_id: "cold-brew", code: "BOM-COLD", branch_id: null, version: 1, yield_qty: 1 }];
    mock.items = [{ bom_id: "recipe", quantity: 0.2, waste_percent: 0, products: { id: "coffee", sell_price: 205_000, is_fnb_stock_item: false } }];
    mock.from.mockImplementation((table: string) => {
      let field = "";
      let ids: string[] = [];
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn((key: string, values: string[]) => { field = key; ids = values; return query; }),
        order: vi.fn().mockReturnThis(),
        then(resolve: (value: unknown) => unknown) {
          const rows = table === "products_scoped" ? mock.products : table === "bom_scoped" ? mock.bom : mock.items;
          return Promise.resolve({ data: rows.filter((row) =>
            ids.includes(String((row as unknown as Record<string, unknown>)[field]))), error: null }).then(resolve);
        },
      };
      return query;
    });
  });

  it("uses the selected branch receipt cost instead of the current Retail price", async () => {
    const result = await getFnbPreparedBomEstimates(["cold-brew"], "branch-a");
    expect(result.get("cold-brew")).toBe(36_000);
    expect(mock.from).toHaveBeenCalledWith("bom_items");
    expect(mock.costs).toHaveBeenCalledWith("branch-a", ["coffee"]);
    expect((await getFnbPreparedBomEstimates(["cold-brew"])).size).toBe(0);
  });

  it("uses the branch recipe when present and normalizes by completed yield", async () => {
    mock.bom.push({ id: "branch-recipe", product_id: "cold-brew", code: "BOM-BRANCH", branch_id: "branch-a", version: 1, yield_qty: 2 });
    mock.items.push({ bom_id: "branch-recipe", quantity: 0.5, waste_percent: 0, products: { id: "coffee", sell_price: 205_000, is_fnb_stock_item: false } });
    const result = await getFnbPreparedBomEstimates(["cold-brew"], "branch-a");
    expect(result.get("cold-brew")).toBe(45_000);
  });

  it("resolves a linked BOM code and withholds estimates for unpriced components", async () => {
    mock.products = [{ id: "cold-brew", bom_code: "BOM-COLD" }];
    mock.bom = [{ id: "recipe", product_id: null, code: "BOM-COLD", branch_id: null, version: 1, yield_qty: 1 }];
    expect((await getFnbPreparedBomEstimates(["cold-brew"], "branch-a")).get("cold-brew")).toBe(36_000);
    mock.costs.mockResolvedValue(new Map());
    expect((await getFnbPreparedBomEstimates(["cold-brew"], "branch-a")).has("cold-brew")).toBe(false);
  });
});
