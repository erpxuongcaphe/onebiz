import { beforeEach, describe, expect, it, vi } from "vitest";

const rowsByTable = vi.hoisted(() => ({
  invoices: [] as Record<string, unknown>[],
  kitchen_orders: [] as Record<string, unknown>[],
  sales_returns: [] as Record<string, unknown>[],
}));
const queryCalls = vi.hoisted(() => [] as Array<[string, unknown[]]>);

vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: Error) => { throw error; },
  getClient: () => ({
    from: (table: "invoices" | "kitchen_orders" | "sales_returns") => {
      let offset = 0;
      const query = {
        select(...args: unknown[]) { queryCalls.push(["select", args]); return query; },
        eq(...args: unknown[]) { queryCalls.push(["eq", args]); return query; },
        in(...args: unknown[]) { queryCalls.push(["in", args]); return query; },
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

import { getCashierPerformance, getFnbInvoiceDetailPage, getFnbKpis, getFnbReturnDetailPage, getRevenueByTable } from "@/lib/services/supabase/fnb-analytics";

describe("F&B report invoice drill-down", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    rowsByTable.invoices = [];
    rowsByTable.kitchen_orders = [];
    rowsByTable.sales_returns = [];
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

  it("filters table revenue by invoice document date, matching the KPI period", async () => {
    await getRevenueByTable("branch-1", { from: "2026-09-22", to: "2026-09-22" });

    expect(queryCalls).toContainEqual(["select", [expect.stringContaining("invoices!inner(total, status, ngay_chung_tu)")]]);
    expect(queryCalls).toContainEqual(["eq", ["invoices.source", "fnb"]]);
    expect(queryCalls).toContainEqual(["not", ["invoices.status", "eq", "cancelled"]]);
    expect(queryCalls).toContainEqual(["gte", ["invoices.ngay_chung_tu", "2026-09-21T17:00:00.000Z"]]);
    expect(queryCalls).toContainEqual(["lt", ["invoices.ngay_chung_tu", "2026-09-22T17:00:00.000Z"]]);
    expect(queryCalls).not.toContainEqual(["gte", ["created_at", expect.anything()]]);
  });

  it("uses the invoice creator FK for the cashier report", async () => {
    rowsByTable.invoices = [
      { total: 120, created_by: "user-1", profiles: { full_name: "Thu ngân" } },
    ];
    const result = await getCashierPerformance("branch-1", { from: "2026-09-22", to: "2026-09-22" });
    expect(result).toEqual([{ cashierName: "Thu ngân", revenue: 120, orders: 1, avgTicket: 120 }]);
    expect(queryCalls).toContainEqual(["select", ["total, created_by, profiles!invoices_created_by_fkey(full_name)"]]);
  });

  it("reconciles invoice gross, F&B returns and net without changing source data", async () => {
    rowsByTable.invoices = [
      { id: "1", total: 27000 }, { id: "2", total: 30000 },
      { id: "3", total: 30000 }, { id: "4", total: 66000 },
    ];
    rowsByTable.sales_returns = [
      { id: "r1", total: 27000 }, { id: "r2", total: 30000 },
      { id: "r3", total: 30000 }, { id: "r4", total: 66000 },
    ];

    const kpis = await getFnbKpis("branch-1", { from: "2026-09-22", to: "2026-09-22" });
    expect(kpis).toMatchObject({ totalRevenue: 153000, returnAmount: 153000, netRevenue: 0, totalOrders: 4 });
    expect(queryCalls).toContainEqual(["eq", ["invoices.source", "fnb"]]);
    expect(queryCalls).toContainEqual(["in", ["status", ["confirmed", "completed"]]]);
    expect(queryCalls).toContainEqual(["gte", ["created_at", "2026-09-21T17:00:00.000Z"]]);
    expect(queryCalls).toContainEqual(["lt", ["created_at", "2026-09-22T17:00:00.000Z"]]);
  });

  it("pages only F&B return documents and preserves the original invoice reference", async () => {
    rowsByTable.sales_returns = [
      { id: "r1", code: "TH1", created_at: "2026-09-22T10:00:00Z", total: 30000, refunded: 20000, invoices: { code: "HD1" } },
      { id: "r2", code: "TH2", created_at: "2026-09-22T11:00:00Z", total: 10000, refunded: 10000, invoices: { code: "HD2" } },
    ];
    const page = await getFnbReturnDetailPage("branch-1", { from: "2026-09-22", to: "2026-09-22" }, 0, 1);
    expect(page.rows).toEqual([{ id: "r1", code: "TH1", createdAt: "2026-09-22T10:00:00Z", invoiceCode: "HD1", total: 30000, refunded: 20000 }]);
    expect(page.hasMore).toBe(true);
    expect(queryCalls).toContainEqual(["eq", ["invoices.source", "fnb"]]);
    expect(queryCalls).toContainEqual(["eq", ["branch_id", "branch-1"]]);
  });
});
