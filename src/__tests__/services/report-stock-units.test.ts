import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, errorTable: "", queries: [] as { table: string; filters: [string, unknown][]; ids: string[]; range?: number[] }[] }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-fixture",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ from: (table: string) => {
    const request = { table, filters: [] as [string, unknown][], ids: [] as string[], range: undefined as number[] | undefined };
    let key = "id";
    const chain = {
      select: () => chain,
      eq: (field: string, value: unknown) => { request.filters.push([field, value]); return chain; },
      in: (field: string, ids: string[]) => { key = field; request.ids = ids; return chain; },
      order: () => chain,
      range: (start: number, end: number) => { request.range = [start, end]; return chain; },
      then: (resolve: (value: unknown) => void) => {
        state.queries.push(request);
        const rows = (state.rows[table] ?? []).filter(row => request.ids.includes(String(row[key]))).slice(request.range?.[0] ?? 0, (request.range?.[1] ?? 499) + 1);
        return Promise.resolve(resolve({ data: rows, error: state.errorTable === table ? { message: "UNITS_READ_FAILED" } : null }));
      },
    };
    return chain;
  } }),
}));
import { getStockReportUnits, stockUnitReferenceKey } from "@/lib/services/supabase/report-stock-units";
const line = { referenceId: "check", productId: "p", actualQuantity: 100 };
beforeEach(() => {
  state.errorTable = ""; state.queries = [];
  state.rows = { products_scoped: [{ id: "p", code: "SKU-CUP", unit: "Cái" }], uom_conversions: [{ id: "u", product_id: "p", from_unit: "Cây", to_unit: "Cái", factor: 100, is_active: true }], operational_uom_requests: [{ reference_id: "check", snapshots: [{ productId: "p", stockUnit: "Cái", stockQuantity: 100, inputUnit: "Cây", inputQuantity: 2, conversionFactor: 50 }] }] };
});
it("keeps current catalog rules separate from the original count and scopes every read", async () => {
  const row = (await getStockReportUnits([line])).get(stockUnitReferenceKey("check", "p"))!;
  expect(row.currentConversion).toBe("1 Cây = 100 Cái");
  expect(row.recordedCount).toBe("2 Cây"); expect(row.recordedUnit).toBe("Cái");
  expect(state.queries).toHaveLength(3);
  for (const query of state.queries) expect(query.filters).toContainEqual(["tenant_id", "tenant-fixture"]);
  expect(state.queries.find(query => query.table === "operational_uom_requests")?.filters).toContainEqual(["reference_type", "inventory_check"]);
});
it("does not relabel historical quantities with current catalog units when no snapshot is visible", async () => {
  state.rows.operational_uom_requests = [];
  const row = (await getStockReportUnits([line])).get("check:p")!;
  expect(row.catalogUnit).toBe("Cái"); expect(row.recordedUnit).toBeNull(); expect(row.recordedCount).toBeNull();
});
it("propagates metadata failures rather than fabricating a missing configuration", async () => {
  state.errorTable = "uom_conversions";
  await expect(getStockReportUnits([line])).rejects.toThrow("UNITS_READ_FAILED");
});
it("paginates conversion metadata and batches IDs instead of issuing one query per line", async () => {
  state.rows.uom_conversions = Array.from({ length: 501 }, (_, index) => ({ id: `u${index}`, product_id: "p", from_unit: `Case${index}`, to_unit: "Cái", factor: 50, is_active: true }));
  await getStockReportUnits(Array.from({ length: 101 }, (_, index) => ({ ...line, productId: index ? `p${index}` : "p" })));
  expect(state.queries.some(query => query.table === "uom_conversions" && query.range?.[0] === 500)).toBe(true);
  expect(state.queries.every(query => query.ids.length <= 100)).toBe(true);
  expect(state.queries.length).toBeLessThan(10);
});
it("does not query any source for an empty report", async () => {
  expect((await getStockReportUnits([])).size).toBe(0); expect(state.queries).toEqual([]);
});
