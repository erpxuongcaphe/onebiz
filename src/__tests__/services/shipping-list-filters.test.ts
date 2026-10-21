import { beforeEach, describe, expect, it, vi } from "vitest";
type RecordedQuery = { calls: unknown[][]; status?: string; range?: [number, number] };
const state = vi.hoisted(() => ({ queries: [] as RecordedQuery[], fail: false, exportRows: false, failLaterPage: false, changeCount: false }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "test-tenant",
  getCurrentContext: vi.fn(),
  getPaginationRange: () => ({ from: 0, to: 14 }),
  handleError: (error: Error) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    const entry: RecordedQuery = { calls: [["from", table]] }; state.queries.push(entry);
    const query = {
      select(...args: unknown[]) { entry.calls.push(["select", ...args]); return this; },
      eq(column: string, value: unknown) { entry.calls.push(["eq", column, value]); if (column === "status") entry.status = String(value); return this; },
      or(value: string) { entry.calls.push(["or", value]); return this; },
      gte(...args: unknown[]) { entry.calls.push(["gte", ...args]); return this; },
      lt(...args: unknown[]) { entry.calls.push(["lt", ...args]); return this; },
      order(...args: unknown[]) { entry.calls.push(["order", ...args]); return this; },
      range(from: number, to: number) { entry.calls.push(["range", from, to]); entry.range = [from, to]; return this; },
      then(resolve: (result: unknown) => unknown) {
        const start = entry.range?.[0] ?? 0;
        const data = state.exportRows && entry.range ? Array.from({ length: Math.max(0, Math.min(entry.range[1] + 1, 1501) - start) }, (_, index) => ({ id: `test-${start + index}`, code: `TEST-${start + index}`, status: "pending" })) : [];
        const count = state.exportRows ? (state.changeCount && start > 0 ? 1500 : 1501) : entry.status === "pending" ? 1501 : 7;
        return Promise.resolve({ data, count, error: state.fail || (state.failLaterPage && start > 0) ? new Error("Synthetic query failure") : null }).then(resolve);
      },
    }; return query;
  } }),
}));
import { getAllShippingOrders, getShippingOrders, getShippingStatusCounts } from "@/lib/services/supabase/shipping";
const params = { search: "TEST", filters: { partner: "test-partner", status: "delivered", dateFrom: "2026-09-01", dateTo: "2026-09-30" } };
beforeEach(() => { state.queries = []; state.fail = false; state.exportRows = false; state.failLaterPage = false; state.changeCount = false; });

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
  it("exports all 1501 matching rows in stable bounded pages, not one capped query", async () => {
    state.exportRows = true;
    const rows = await getAllShippingOrders(params);
    expect(rows).toHaveLength(1501);
    expect(rows[0].id).toBe("test-0");
    expect(rows[1500].id).toBe("test-1500");
    expect(state.queries).toHaveLength(8);
    for (const query of state.queries) {
      expect(query.calls).toContainEqual(["eq", "partner_id", "test-partner"]);
      expect(query.calls).toContainEqual(["eq", "status", "delivered"]);
      expect(query.calls).toContainEqual(["gte", "created_at", "2026-08-31T17:00:00.000Z"]);
      expect(query.calls).toContainEqual(["order", "id", { ascending: false }]);
      expect(query.range![1] - query.range![0] + 1).toBe(200);
    }
  });
  it("rejects a later page failure rather than returning a partial export", async () => {
    state.exportRows = true; state.failLaterPage = true;
    await expect(getAllShippingOrders(params)).rejects.toThrow("Synthetic query failure");
  });
  it("rejects an export if its total changes during pagination", async () => {
    state.exportRows = true; state.changeCount = true;
    await expect(getAllShippingOrders(params)).rejects.toThrow("Số dòng lịch sử thay đổi");
  });
});
