import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cost: 0, valuation: 0 as number | null, quantity: 4, skuInput: false, selects: [] as string[] }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ from: (table: string) => {
    let result: any = { data: [], count: 0, error: null };
    const chain: any = {
      select: (selection: string) => {
        state.selects.push(selection);
        if (/products:product_id.*cost_price/.test(selection)) {
          result = { data: null, error: { message: "permission denied for table products" } };
        } else if (table === "bom_scoped" && state.skuInput) {
          result = { data: [{ id: "recipe" }], error: null };
        } else if (table === "bom_items" && state.skuInput) {
          result = { data: [{ material_id: "p" }], error: null };
        } else if (table === "branch_stock") {
          result = { data: [{ product_id: "p", branch_id: "b", quantity: state.quantity,
            branches: { name: "Quán" }, products: { code: "NVL", name: "Đường", unit: "G",
              product_type: state.skuInput ? "sku" : "nvl", cost_price: state.cost, min_stock: 5, max_stock: 100 } }], error: null };
        }
        return chain;
      },
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    for (const method of ["eq", "gte", "lt", "gt", "in", "not", "lte", "order", "limit", "or"]) chain[method] = () => chain;
    return chain;
  } }),
}));

vi.mock("@/lib/services/supabase/stock-valuation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/stock-valuation")>(),
  getStockValuations: async () => state.valuation === null ? [] : [{ branchId: "b", productId: "p", quantity: state.quantity,
    unitCost: state.valuation, value: state.quantity * state.valuation, complete: true }],
}));

import { getNvlStock, getProductionKpis } from "@/lib/services/supabase/production-dashboard";

describe("production dashboard with scoped product costs", () => {
  it("warns about negative and empty stock even without a minimum threshold", async () => {
    state.quantity = -2;
    const [rows, kpis] = await Promise.all([getNvlStock({ lowStockOnly: true }), getProductionKpis()]);
    expect(rows[0]).toMatchObject({ quantity: -2, isOut: true, isLow: false });
    expect(kpis.nvlLowStockCount).toBe(1);
    state.quantity = 0;
    expect((await getNvlStock())[0].isOut).toBe(true);
    state.quantity = 4;
  });
  it("keeps stock and low-stock indicators usable when cost is masked", async () => {
    state.cost = 0;
    state.valuation = null;
    state.skuInput = false;
    state.selects = [];
    const [rows, kpis] = await Promise.all([getNvlStock({ branchId: "b" }), getProductionKpis("b")]);
    expect(rows[0]).toMatchObject({ quantity: 4, isLow: true, costPrice: 0, stockValue: 0, valuationComplete: false });
    expect(kpis).toMatchObject({ nvlLowStockCount: 1, nvlStockValue: 0, nvlStockValueComplete: false });
    expect(state.selects.filter(s => s.includes("cost_price")).every(s => s.includes("products:products_scoped"))).toBe(true);
  });
  it("uses permitted costs without changing physical quantities", async () => {
    state.cost = 9999; // stale catalog price must never value branch stock
    state.valuation = 12;
    state.skuInput = false;
    const rows = await getNvlStock({ branchId: "b" });
    expect(rows[0]).toMatchObject({ quantity: 4, costPrice: 12, stockValue: 48 });
  });
  it("includes a purchased SKU consumed by a branch recipe as a production input", async () => {
    state.skuInput = true;
    const [rows, kpis] = await Promise.all([getNvlStock({ branchId: "b" }), getProductionKpis("b")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(4);
    expect(kpis.nvlLowStockCount).toBe(1);
  });
});
