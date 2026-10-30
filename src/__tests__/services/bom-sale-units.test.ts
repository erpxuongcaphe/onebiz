import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: [] as unknown[][], fail: false }));
vi.mock("@/lib/services/supabase/base", () => ({ getCurrentTenantId: async () => "tenant-test", handleError: (error: { message: string }) => { throw Error(error.message); }, getClient: () => ({ from: (table: string) => {
  state.calls.push(["from", table]); const query = {} as Record<string, unknown>;
  for (const method of ["select", "eq", "in", "order"]) query[method] = (...args: unknown[]) => { state.calls.push([method, ...args]); return query; };
  query.range = async (from: number, to: number) => ({ data: state.rows.slice(from, to + 1), error: state.fail ? { message: "Denied" } : null }); return query;
} }) }));
import { getBomSaleUnits } from "@/lib/services/supabase/bom-sale-units";
const line = { invoiceId: "bill-1", productId: "p-1", productName: "Sản phẩm thử", qtySold: 2, revenue: 100 };
const item = { id: "item-1", invoice_id: "bill-1", product_id: "p-1", product_name: "Sản phẩm thử", quantity: "2", total: "100", unit: "Cái" };
beforeEach(() => { state.calls = []; state.fail = false; state.rows = [item]; });
it("reads only scoped bill/product IDs under the current tenant and matches the historical quantity", async () => {
  expect(await getBomSaleUnits([line])).toEqual(["Cái"]);
  expect(state.calls).toContainEqual(["from", "invoice_items_scoped"]);
  expect(state.calls).toContainEqual(["eq", "invoices.tenant_id", "tenant-test"]);
  expect(state.calls).toContainEqual(["in", "invoice_id", ["bill-1"]]);
  expect(state.calls).toContainEqual(["in", "product_id", ["p-1"]]);
  expect(await getBomSaleUnits([{ ...line, qtySold: 3 }])).toEqual([null]);
});
it("does not guess between different unit candidates for identical source fields", async () => {
  state.rows = [item, { ...item, id: "item-2", unit: "Hộp" }];
  expect(await getBomSaleUnits([line, line])).toEqual([null, null]);
});
it("keeps repeated matching units and does not manufacture a unit from incomplete rows", async () => {
  state.rows = [item, { ...item, id: "item-2" }]; expect(await getBomSaleUnits([line, line])).toEqual(["Cái", "Cái"]);
  state.rows = [item, { ...item, id: "item-3", unit: null }]; expect(await getBomSaleUnits([line])).toEqual([null]);
});
it("does not read anything for an empty report or swallow a source failure", async () => {
  expect(await getBomSaleUnits([])).toEqual([]); expect(state.calls).toHaveLength(0);
  state.fail = true; await expect(getBomSaleUnits([line])).rejects.toThrow("Denied");
});
