import { beforeEach, describe, expect, it, vi } from "vitest";

const rowsByTable = vi.hoisted(() => ({
  invoices: [] as Record<string, unknown>[],
  kitchen_orders: [] as Record<string, unknown>[],
}));
const queryCalls = vi.hoisted(() => [] as Array<[string, unknown[]]>);

vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: Error) => { throw error; },
  getClient: () => ({
    from: (table: "invoices" | "kitchen_orders") => {
      let offset = 0;
      const query = {
        select(...args: unknown[]) { queryCalls.push(["select", args]); return query; },
        eq(...args: unknown[]) { queryCalls.push(["eq", args]); return query; },
        not(...args: unknown[]) { queryCalls.push(["not", args]); return query; },
        gte(...args: unknown[]) { queryCalls.push(["gte", args]); return query; },
        lt(...args: unknown[]) { queryCalls.push(["lt", args]); return query; },
        order(...args: unknown[]) { queryCalls.push(["order", args]); return query; },
        async range(from: number, to: number) {
          offset = from;
          queryCalls.push(["range", [from, to]]);
          return { data: rowsByTable[table].slice(offset, to + 1), error: null };
        },
      };
      return query;
    },
  }),
}));

import { getFnbInvoiceDetailPage, getRevenueByTable } from "@/lib/services/supabase/fnb-analytics";

describe("F&B report invoice drill-down", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    rowsByTable.invoices = [];
    rowsByTable.kitchen_orders = [];
  });

  it("scopes invoice detail to tenant, F&B source, branch and a bounded page", async () => {
    rowsByTable.invoices = [
      { id: "1", code: "HD1", ngay_chung_tu: "2026-09-22T10:00:00Z", customer_name: "", total: 100, paid: 80, debt: 20, payment_method: "cash" },
      { id: "2", code: "HD2", ngay_chung_tu: "2026-09-22T11:00:00Z", customer_name: "An", total: 50, paid: 50, debt: 0, payment_method: "card" },
    ];
    const result = await getFnbInvoiceDetailPage("branch-1", { from: "2026-09-22", to: "2026-09-22" }, 0, 1);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ code: "HD1", customerName: "Khách lẻ", debt: 20 });
    expect(result.hasMore).toBe(true);
    expect(queryCalls).toContainEqual(["eq", ["tenant_id", "tenant-1"]]);
    expect(queryCalls).toContainEqual(["eq", ["source", "fnb"]]);
    expect(queryCalls).toContainEqual(["eq", ["branch_id", "branch-1"]]);
    expect(queryCalls).toContainEqual(["range", [0, 1]]);
  });

  it("counts a completed invoice only once when multiple kitchen sends exist", async () => {
    rowsByTable.kitchen_orders = [
      { id: "k1", table_id: "t1", invoice_id: "i1", restaurant_tables: { name: "Bàn 1" }, invoices: { total: 120, status: "completed" } },
      { id: "k2", table_id: "t1", invoice_id: "i1", restaurant_tables: { name: "Bàn 1" }, invoices: { total: 120, status: "completed" } },
      { id: "k3", table_id: "t1", invoice_id: "i2", restaurant_tables: { name: "Bàn 1" }, invoices: { total: 80, status: "cancelled" } },
    ];

    expect(await getRevenueByTable("branch-1")).toEqual([{ tableName: "Bàn 1", revenue: 120, orders: 1 }]);
  });
});
