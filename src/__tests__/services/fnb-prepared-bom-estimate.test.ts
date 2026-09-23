import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFnbPreparedBomEstimates } from "@/lib/services/supabase/bom";

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  products: [] as Array<{ id: string; bom_code: string | null }>,
  bom: [] as Array<{ id: string; product_id: string | null; code: string; branch_id: string | null; version: number; yield_qty: number }>,
  items: [] as Array<{ bom_id: string; quantity: number; waste_percent: number; products: { sell_price: number; is_fnb_stock_item: boolean } | null }>,
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mock.from }),
  getCurrentTenantId: async () => "tenant-a",
}));

describe("prepared F&B BOM estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.products = [{ id: "cold-brew", bom_code: null }];
    mock.bom = [{ id: "recipe", product_id: "cold-brew", code: "BOM-COLD", branch_id: null, version: 1, yield_qty: 1 }];
    mock.items = [{ bom_id: "recipe", quantity: 0.2, waste_percent: 0, products: { sell_price: 205_000, is_fnb_stock_item: false } }];
    mock.from.mockImplementation((table: string) => {
      let field = "";
      let ids: string[] = [];
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn((key: string, values: string[]) => { field = key; ids = values; return query; }),
        order: vi.fn().mockReturnThis(),
        then(resolve: (value: unknown) => unknown) {
          const rows = table === "products" ? mock.products : table === "bom" ? mock.bom : mock.items;
          return Promise.resolve({ data: rows.filter((row) =>
            ids.includes(String((row as unknown as Record<string, unknown>)[field]))), error: null }).then(resolve);
        },
      };
      return query;
    });
  });

  it("uses current Retail selling price rather than stored Retail cost", async () => {
    const result = await getFnbPreparedBomEstimates(["cold-brew"]);
    expect(result.get("cold-brew")).toBe(41_000);
    expect(mock.from).toHaveBeenCalledWith("bom_items");
    expect(mock.from).not.toHaveBeenCalledWith("fnb_branch_product_cost_balances");
  });

  it("uses the branch recipe when present and normalizes by completed yield", async () => {
    mock.bom.push({ id: "branch-recipe", product_id: "cold-brew", code: "BOM-BRANCH", branch_id: "branch-a", version: 1, yield_qty: 2 });
    mock.items.push({ bom_id: "branch-recipe", quantity: 0.5, waste_percent: 0, products: { sell_price: 205_000, is_fnb_stock_item: false } });
    const result = await getFnbPreparedBomEstimates(["cold-brew"], "branch-a");
    expect(result.get("cold-brew")).toBe(51_250);
  });

  it("resolves a linked BOM code and withholds estimates for unpriced components", async () => {
    mock.products = [{ id: "cold-brew", bom_code: "BOM-COLD" }];
    mock.bom = [{ id: "recipe", product_id: null, code: "BOM-COLD", branch_id: null, version: 1, yield_qty: 1 }];
    expect((await getFnbPreparedBomEstimates(["cold-brew"])).get("cold-brew")).toBe(41_000);
    mock.items[0].products!.sell_price = 0;
    expect((await getFnbPreparedBomEstimates(["cold-brew"])).has("cold-brew")).toBe(false);
  });
});
