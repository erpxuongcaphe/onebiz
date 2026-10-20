import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: api.rpc }),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getInventoryCatalogPage, getInventoryCatalogRows } from "@/lib/services/supabase/inventory-catalog";
const row = {
  id: "catalog:warehouse:cold", branch_id: "warehouse", branch_name: "Kho Tổng", branch_code: "BOF-002",
  product_id: "cold", product_code: "SKU-COLD", product_name: "Túi ủ Coldbrew 20x14", product_type: "sku",
  unit: "Túi", min_stock: 5, max_stock: null, variant_id: null, variant_name: null,
  quantity: 0, reserved: 0, available: 0, updated_at: null, unit_cost: null, stock_value: 0,
};
const payload = (rows: Array<Omit<typeof row, "stock_value"> & { stock_value: number | null }> = [row], total = rows.length) => ({ rows, total, total_products: total,
  total_value: 0, valuation_complete: true, low_stock_count: 1 });
beforeEach(() => api.rpc.mockReset());
describe("inventory management active catalog", () => {
  it("displays an active Coldbrew code with zero stock without creating balance records", async () => {
    api.rpc.mockResolvedValue({ data: payload(), error: null });
    const result = await getInventoryCatalogPage({ branchId: "warehouse", search: " coldbrew " });
    expect(result.rows[0]).toMatchObject({ id: "catalog:warehouse:cold", productCode: "SKU-COLD",
      quantity: 0, reserved: 0, available: 0, stockValue: 0, valuationComplete: true, updatedAt: "" });
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("get_inventory_catalog_00573", {
      p_branch_id: "warehouse", p_product_type: null, p_search: "coldbrew", p_stock_filter: "all",
      p_low_stock_only: false, p_offset: 0, p_limit: 20,
    });
  });
  it.each(["positive", "zero", "negative"] as const)("passes %s filter before pagination and retains server totals", async (stockFilter) => {
    api.rpc.mockResolvedValue({ data: { ...payload([], 123), total_value: 45000, low_stock_count: 7 }, error: null });
    const result = await getInventoryCatalogPage({ stockFilter, offset: 20, limit: 20, lowStockOnly: true, productType: "nvl" });
    expect(api.rpc.mock.calls[0][1]).toMatchObject({ p_stock_filter: stockFilter, p_offset: 20,
      p_limit: 20, p_low_stock_only: true, p_product_type: "nvl" });
    expect(result).toMatchObject({ rows: [], total: 123, totalValue: 45000, lowStockCount: 7 });
  });
  it("does not present unknown nonzero stock value as a confirmed zero cost", async () => {
    api.rpc.mockResolvedValue({ data: payload([{ ...row, quantity: 3, stock_value: null }]), error: null });
    const result = await getInventoryCatalogPage({});
    expect(result.rows[0].valuationComplete).toBe(false);
    expect(result.rows[0].costPrice).toBeUndefined();
  });
  it("exports every row using the same search and filters as the table", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ ...row, id: String(i) }));
    api.rpc.mockResolvedValueOnce({ data: payload(first, 1001), error: null })
      .mockResolvedValueOnce({ data: payload([{ ...row, id: "last" }], 1001), error: null });
    const rows = await getInventoryCatalogRows({ branchId: "warehouse", search: "coldbrew", stockFilter: "zero", lowStockOnly: true });
    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)?.id).toBe("last");
    for (const [, request] of api.rpc.mock.calls) expect(request).toMatchObject({ p_branch_id: "warehouse",
      p_search: "coldbrew", p_stock_filter: "zero", p_low_stock_only: true, p_limit: 1000 });
    expect(api.rpc.mock.calls.map(([, request]) => request.p_offset)).toEqual([0, 1000]);
  });
  it("reports a missing backend or denied scope instead of silently hiding active products", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "INVENTORY_CATALOG_BRANCH_DENIED" } });
    await expect(getInventoryCatalogPage({ branchId: "other" })).rejects.toThrow("INVENTORY_CATALOG_BRANCH_DENIED");
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });
});
