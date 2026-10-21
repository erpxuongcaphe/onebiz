import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], queries: [] as { table: string; calls: [string, unknown[]][] }[],
  failOffset: -1, changedCountOffset: -1,
}));
vi.mock("@/lib/services/supabase/stock-valuation", () => ({ getStockValuations: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue("test-tenant"),
  getPaginationRange: ({ page = 0, pageSize = 50 }) => ({ from: page * pageSize, to: (page + 1) * pageSize - 1 }),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ from: (table: string) => {
    const record = { table, calls: [] as [string, unknown[]][] };
    state.queries.push(record);
    let from = 0, to = 49;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "or", "ilike", "in", "gt", "lte", "gte", "lt", "order", "limit"]) {
      query[method] = (...args: unknown[]) => { record.calls.push([method, args]); return query; };
    }
    query.range = (start: number, end: number) => { from = start; to = end; record.calls.push(["range", [start, end]]); return query; };
    query.maybeSingle = async () => ({ data: { cascade_mode: "outlet" }, error: null });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: state.rows.slice(from, to + 1),
      count: state.rows.length + (from === state.changedCountOffset ? 1 : 0),
      error: from === state.failOffset ? { message: "test page failure" } : null,
    }).then(resolve);
    return query;
  } }),
}));
import { getAllMatchingProductIds, getProducts, getProductsForExport } from "@/lib/services/supabase/products";

const params = {
  page: 0, pageSize: 50, branchId: "test-branch", search: "TEST", searchField: "code" as const,
  filters: { productType: "sku", channel: "retail", supplierName: "  Test Supplier  ", dateFrom: "2026-01-01", dateTo: "2026-01-02" },
};
const productQueries = () => state.queries.filter(query => query.table === "products_scoped");
beforeEach(() => {
  state.rows = [];
  state.queries = [];
  state.failOffset = -1;
  state.changedCountOffset = -1;
});

describe("product list filters", () => {
  it("uses the same linked supplier, search, branch and Vietnam dates for list and selection", async () => {
    await getProducts(params);
    await getAllMatchingProductIds(params);
    for (const query of productQueries()) {
      expect(query.calls.find(([method]) => method === "select")?.[1][0]).toContain("suppliers!products_supplier_id_fkey!inner(name)");
      expect(query.calls).toContainEqual(["ilike", ["suppliers.name", "%Test Supplier%"]]);
      expect(query.calls).toContainEqual(["ilike", ["code", "%TEST%"]]);
      expect(query.calls).toContainEqual(["eq", ["tenant_id", "test-tenant"]]);
      expect(query.calls).toContainEqual(["eq", ["branch_stock.branch_id", "test-branch"]]);
      expect(query.calls).toContainEqual(["eq", ["product_type", "sku"]]);
      expect(query.calls).toContainEqual(["eq", ["channel", "retail"]]);
      expect(query.calls).toContainEqual(["gte", ["created_at", "2025-12-31T17:00:00.000Z"]]);
      expect(query.calls).toContainEqual(["lt", ["created_at", "2026-01-02T17:00:00.000Z"]]);
    }
  });

  it("keeps products without suppliers when no supplier filter is selected", async () => {
    await getProducts({ page: 0, pageSize: 50, filters: { supplierName: "  " } });
    const query = productQueries()[0];
    expect(query.calls.find(([method]) => method === "select")?.[1][0]).toContain("suppliers!products_supplier_id_fkey(name)");
    expect(query.calls.filter(([method]) => method === "ilike")).toHaveLength(0);
  });

  it("treats wildcard characters as literal supplier name characters", async () => {
    await getProducts({ page: 0, pageSize: 50, filters: { supplierName: "Test 50%_*\\" } });
    expect(productQueries()[0].calls).toContainEqual(["ilike", ["suppliers.name", "%Test 50\\%\\_\\*\\\\%"]]);
  });

  it.each(["ids", "export"])("loads all matching %s beyond one server page", async kind => {
    state.rows = Array.from({ length: 1501 }, (_, index) => ({ id: `test-${index}`, code: `TEST-${index}`, name: "Test product" }));
    const result = kind === "ids" ? await getAllMatchingProductIds(params) : await getProductsForExport(params);
    expect(result).toHaveLength(1501);
    expect(productQueries()).toHaveLength(8);
    for (const query of productQueries()) {
      const range = query.calls.find(([method]) => method === "range")![1] as number[];
      expect(range[1] - range[0] + 1).toBe(200);
      expect(query.calls).toContainEqual(["order", ["id", { ascending: kind === "ids" }]]);
      expect(query.calls).toContainEqual(["ilike", ["suppliers.name", "%Test Supplier%"]]);
    }
  });

  it.each(["ids", "export"])("rejects later-page errors instead of returning partial %s", async kind => {
    state.rows = Array.from({ length: 201 }, (_, index) => ({ id: `test-${index}` }));
    state.failOffset = 200;
    await expect(kind === "ids" ? getAllMatchingProductIds(params) : getProductsForExport(params)).rejects.toThrow("test page failure");
  });

  it("rejects a changed result count while reading selected IDs", async () => {
    state.rows = Array.from({ length: 201 }, (_, index) => ({ id: `test-${index}` }));
    state.changedCountOffset = 200;
    await expect(getAllMatchingProductIds(params)).rejects.toThrow("thay đổi");
  });
});
