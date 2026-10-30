import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ from: vi.fn(), products: [] as unknown[], items: [] as unknown[], calls: [] as unknown[][], error: false }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ from: state.from }), getCurrentTenantId: async () => "tenant",
  handleError: () => { throw new Error("Source unavailable"); } }));
import { getAbcReport } from "@/lib/services/supabase/abc-analysis";
const range = { from: "2026-10-01", to: "2026-10-29" };
beforeEach(() => {
  vi.clearAllMocks(); state.calls = []; state.products = []; state.items = []; state.error = false;
  state.from.mockImplementation(table => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lt", "order"]) query[method] = (...args: unknown[]) => { state.calls.push([table, method, ...args]); return query; };
    query.range = async (from: number, to: number) => {
      state.calls.push([table, "range", from, to]);
      return { data: (table === "products_scoped" ? state.products : state.items).slice(from, to + 1), error: state.error ? { message: "fail" } : null };
    };
    return query;
  });
});
describe("ABC authorized source reads", () => {
  it("reads every page and normalizes all branches without an all UUID predicate", async () => {
    state.products = Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}`, code: `SKU${i}`, name: `Item${i}`, unit: "Cái", is_active: true }));
    const report = await getAbcReport({ range, branchId: "all" });
    expect(report.rows).toHaveLength(1001);
    expect(state.calls).toContainEqual(["products_scoped", "range", 1000, 1999]);
    expect(state.calls.some(call => call[2] === "invoices.branch_id")).toBe(false);
    expect(state.calls).toContainEqual(["invoice_items_scoped", "eq", "invoices.tenant_id", "tenant"]);
    expect(state.calls).toContainEqual(["invoice_items_scoped", "eq", "invoices.status", "completed"]);
  });
  it("filters a branch and a half-open Vietnamese date window", async () => {
    await getAbcReport({ range, branchId: "branch-a" });
    expect(state.calls).toContainEqual(["invoice_items_scoped", "eq", "invoices.branch_id", "branch-a"]);
    expect(state.calls).toContainEqual(["invoice_items_scoped", "gte", "invoices.ngay_chung_tu", "2026-09-30T17:00:00.000Z"]);
    expect(state.calls).toContainEqual(["invoice_items_scoped", "lt", "invoices.ngay_chung_tu", "2026-10-29T17:00:00.000Z"]);
    expect(state.calls).not.toContainEqual(["products_scoped", "eq", "is_active", true]);
  });
  it("propagates source failure instead of a successful empty report", async () => {
    state.error = true; await expect(getAbcReport({ range })).rejects.toThrow("Source unavailable");
  });
  it("rejects reversed periods before querying", async () => {
    await expect(getAbcReport({ range: { from: "2026-10-29", to: "2026-10-01" } })).rejects.toThrow();
    expect(state.from).not.toHaveBeenCalled();
  });
});
