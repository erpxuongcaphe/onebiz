import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as Array<{ calls: unknown[][]; status?: string }>, fail: false }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "test-tenant",
  getCurrentContext: vi.fn(),
  getPaginationRange: () => ({ from: 0, to: 14 }),
  handleError: (error: Error) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    const entry: { calls: unknown[][]; status?: string } = { calls: [["from", table]] }; state.queries.push(entry);
    const query = {
      select(...args: unknown[]) { entry.calls.push(["select", ...args]); return this; },
      eq(column: string, value: unknown) { entry.calls.push(["eq", column, value]); if (column === "status") entry.status = String(value); return this; },
      or(value: string) { entry.calls.push(["or", value]); return this; },
      gte(...args: unknown[]) { entry.calls.push(["gte", ...args]); return this; },
      lt(...args: unknown[]) { entry.calls.push(["lt", ...args]); return this; },
      order(...args: unknown[]) { entry.calls.push(["order", ...args]); return this; },
      range(...args: unknown[]) { entry.calls.push(["range", ...args]); return this; },
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: [], count: entry.status === "pending" ? 1501 : 7, error: state.fail ? new Error("Synthetic query failure") : null }).then(resolve); },
    }; return query;
  } }),
}));
import { getShippingOrders, getShippingStatusCounts } from "@/lib/services/supabase/shipping";
const params = { search: "TEST", filters: { partner: "test-partner", status: "delivered", dateFrom: "2026-09-01", dateTo: "2026-09-30" } };
beforeEach(() => { state.queries = []; state.fail = false; });

describe("shipping list and exact status counts", () => {
  it("uses the same search, partner and Vietnam date window for list and all status counts", async () => {
    await getShippingOrders({ ...params, page: 0, pageSize: 15 });
    await getShippingStatusCounts(params);
    expect(state.queries).toHaveLength(7);
    for (const query of state.queries) {
      expect(query.calls).toContainEqual(["eq", "tenant_id", "test-tenant"]);
      expect(query.calls).toContainEqual(["eq", "partner_id", "test-partner"]);
      expect(query.calls).toContainEqual(["or", "code.ilike.%TEST%,receiver_phone.ilike.%TEST%"]);
      expect(query.calls).toContainEqual(["gte", "created_at", "2026-08-31T17:00:00.000Z"]);
      expect(query.calls).toContainEqual(["lt", "created_at", "2026-09-30T17:00:00.000Z"]);
      expect(query.calls.filter(call => call[0] === "eq" && call[1] === "status")).toHaveLength(1);
    }
    expect(state.queries[0].status).toBe("delivered");
    expect(new Set(state.queries.slice(1).map(query => query.status)).size).toBe(6);
  });
  it("counts beyond API row limits without downloading or paginating shipments", async () => {
    const result = await getShippingStatusCounts();
    expect(result.pending).toBe(1501);
    for (const query of state.queries) {
      expect(query.calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
      expect(query.calls.some(call => call[0] === "range")).toBe(false);
    }
  });
  it("reports query errors instead of presenting a zero count", async () => {
    state.fail = true;
    await expect(getShippingStatusCounts(params)).rejects.toThrow("Synthetic query failure");
  });
});
