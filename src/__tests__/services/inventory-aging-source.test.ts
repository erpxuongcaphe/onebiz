import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), units: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: state.rpc }), getCurrentTenantId: async () => "tenant", handleError: (error: { message: string }) => { throw new Error(error.message); } }));
vi.mock("@/lib/services/supabase/report-stock-units", () => ({ getStockReportUnits: state.units, stockUnitReferenceKey: (a: string, b: string) => `${a}:${b}` }));
import { getInventoryAgingReport } from "@/lib/services/supabase/inventory-reports";
const rawRow = { product_id: "p", code: "SKU-CUP", name: "Cup", current_qty: 50, cost_price: null, stock_value: null, last_in_date: null, days_in_stock: null,
  last_sale_date: null, days_since_last_sale: null, aging_bucket: "unknown", is_dead_stock: false };
const report = (rows: Record<string, unknown>[] = [rawRow], branch: string | null = null) => ({ generated_at: "2026-10-30T10:00:00Z", tenant_id: "tenant", branch_id: branch, rows });
beforeEach(() => { vi.clearAllMocks(); state.rpc.mockResolvedValue({ data: report(), error: null }); state.units.mockResolvedValue(new Map([["p:p", { catalogUnit: "Cái", currentConversion: "1 Cây = 50 Cái" }]])); });
it("normalizes all scope and preserves unknown cost/day values", async () => {
  const result = await getInventoryAgingReport({ branchId: "all" });
  expect(state.rpc).toHaveBeenCalledWith("get_inventory_aging_report", { p_branch_id: null });
  expect(result.rows[0]).toMatchObject({ costPrice: null, stockValue: null, daysInStock: null, daysSinceLastSale: null, catalogUnit: "Cái" });
});
it.each([{ tenant_id: "other" }, { branch_id: "other" }, { rows: null }, { generated_at: "invalid" }])("rejects mismatched source scope or shape %s", async extra => {
  state.rpc.mockResolvedValue({ data: { ...report(), ...extra }, error: null }); await expect(getInventoryAgingReport()).rejects.toThrow(); expect(state.units).not.toHaveBeenCalled();
});
it("rejects duplicated product rows instead of double-counting stock", async () => {
  state.rpc.mockResolvedValue({ data: report([rawRow, rawRow]), error: null }); await expect(getInventoryAgingReport()).rejects.toThrow("trùng");
});
it("keeps branch scope exact and preserves genuine zero value", async () => {
  state.rpc.mockResolvedValue({ data: report([{ ...rawRow, cost_price: 0, stock_value: 0 }], "a"), error: null });
  expect((await getInventoryAgingReport({ branchId: "a" })).rows[0].stockValue).toBe(0);
});
it("propagates source errors without a successful empty report", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Permission denied" } }); await expect(getInventoryAgingReport()).rejects.toThrow("Permission denied");
});
it.each([{ current_qty: null }, { stock_value: "bad" }, { last_in_date: "bad-date" }, { aging_bucket: "unrecognized" }])("rejects invalid fields %s", async extra => {
  state.rpc.mockResolvedValue({ data: report([{ ...rawRow, ...extra }]), error: null }); await expect(getInventoryAgingReport()).rejects.toThrow();
});
