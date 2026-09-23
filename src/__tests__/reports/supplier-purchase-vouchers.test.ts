import { describe, expect, it, vi } from "vitest";

const calls: Array<[string, unknown]> = [];
const query = new Proxy({} as Record<string, unknown>, {
  get(_target, property) {
    if (property === "then") return (resolve: (value: unknown) => void) => resolve({ data: [], count: 0, error: null });
    return (...args: unknown[]) => {
      calls.push([String(property), args]);
      return query;
    };
  },
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: () => query }),
  getCurrentTenantId: async () => "tenant-1",
  getPaginationRange: () => ({ from: 0, to: 49 }),
  handleError: (error: Error) => { throw error; },
}));

const { getPurchaseOrders } = await import("@/lib/services/supabase/purchase-orders");

describe("supplier purchase voucher report query", () => {
  it("keeps the retail purchase list's default newest-first ordering", async () => {
    calls.length = 0;
    await getPurchaseOrders({ page: 0, pageSize: 50 });
    expect(calls.filter(([name]) => name === "order")).toEqual([
      ["order", ["created_at", { ascending: false }]],
    ]);
  });

  it("sorts the full filtered report before pagination", async () => {
    calls.length = 0;
    await getPurchaseOrders({
      page: 0, pageSize: 50, branchId: "branch-1", sortBy: "debt", sortOrder: "desc",
      filters: { status: "completed", dateFrom: "2026-09-01", dateTo: "2026-09-30" },
    });
    expect(calls).toContainEqual(["eq", ["tenant_id", "tenant-1"]]);
    expect(calls).toContainEqual(["eq", ["branch_id", "branch-1"]]);
    expect(calls).toContainEqual(["eq", ["status", "completed"]]);
    const orders = calls.filter(([name]) => name === "order");
    expect(orders).toEqual([
      ["order", ["debt", { ascending: false }]],
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
    ]);
    expect(calls.findIndex(([name]) => name === "range")).toBeGreaterThan(calls.findIndex(([name]) => name === "order"));
  });
});
