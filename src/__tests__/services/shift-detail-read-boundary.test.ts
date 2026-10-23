import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => api,
  getCurrentTenantId: async () => "tenant-a",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getReconciledShiftDetail } from "@/lib/services/supabase/shifts";

const context = () => ({ mode: "reconciliation", shift: {
  id: "shift-a", tenant_id: "tenant-a", branch_id: "branch-a",
} });
const invoice = (index: number) => ({
  id: `invoice-${index}`, code: `HD${index}`, status: "completed", total: 100,
  paid: 100, payment_method: "cash", source: "fnb", created_at: "2026-10-01T01:00:00Z",
});
const cash = (index: number) => ({
  id: `cash-${index}`, code: `PT${index}`, type: "receipt", amount: 100,
  payment_method: "cash", status: index === 0 ? "cancelled" : "completed",
  category: "Ban hang", transaction_date: "2026-10-01",
});

const queries: { table: string; filters: unknown[][]; orders: unknown[][]; ranges: number[][] }[] = [];
function tables(rows: Record<string, unknown[]>, alter?: (table: string, offset: number) => object) {
  api.from.mockImplementation((table: string) => {
    const record = { table, filters: [] as unknown[][], orders: [] as unknown[][], ranges: [] as number[][] };
    queries.push(record);
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((...args) => { record.filters.push(args); return query; }),
      order: vi.fn((...args) => { record.orders.push(args); return query; }),
      range: vi.fn(async (start: number, end: number) => {
        record.ranges.push([start, end]);
        return { data: rows[table].slice(start, end + 1), count: rows[table].length,
          error: null, ...alter?.(table, start) };
      }),
    };
    return query;
  });
}
beforeEach(() => {
  vi.resetAllMocks(); queries.length = 0;
  api.rpc.mockResolvedValue({ data: context(), error: null });
  tables({ invoices: [], cash_transactions: [] });
});

describe("shift detail staged read boundary", () => {
  it("loads all pages and binds each source to the authorized branch and shift", async () => {
    tables({ invoices: Array.from({ length: 1201 }, (_, i) => invoice(i)),
      cash_transactions: Array.from({ length: 1001 }, (_, i) => cash(i)) });
    const result = await getReconciledShiftDetail("shift-a");
    expect(result.invoices).toHaveLength(1201);
    expect(result.transactions).toHaveLength(1001);
    expect(result.summary.completedSales).toBe(120100);
    expect(result.summary.cashReceipts).toBe(100000);
    expect(result.transactions[0].status).toBe("cancelled");
    expect(api.rpc).toHaveBeenCalledWith("get_shift_context_scoped", { p_shift_id: "shift-a" });
    for (const query of queries) {
      expect(query.filters).toEqual([["tenant_id", "tenant-a"], ["branch_id", "branch-a"], ["shift_id", "shift-a"]]);
      expect(query.orders.at(-1)).toEqual(["id", { ascending: true }]);
    }
    for (const table of ["invoices", "cash_transactions"]) {
      expect(queries.filter(query => query.table === table).flatMap(query => query.ranges))
        .toEqual([[0, 499], [500, 999], [1000, 1499]]);
    }
  });

  it.each([
    null, { mode: "blind", shift: context().shift },
    { ...context(), shift: { ...context().shift, id: "other" } },
    { ...context(), shift: { ...context().shift, tenant_id: "other" } },
    { ...context(), shift: { ...context().shift, branch_id: null } },
  ])("does not read document tables without confirmed reconciliation context", async (data) => {
    api.rpc.mockResolvedValue({ data, error: null });
    await expect(getReconciledShiftDetail("shift-a")).rejects.toThrow();
    expect(api.from).not.toHaveBeenCalled();
  });

  it("does not fall back after a denied context request", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(getReconciledShiftDetail("shift-a")).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });

  it.each(["count", "duplicate", "empty", "error", "null"])("rejects incomplete pagination: %s", async (failure) => {
    tables({ invoices: Array.from({ length: 501 }, (_, i) => invoice(i)), cash_transactions: [] },
      (table, offset) => {
        if (table !== "invoices" || offset !== 500) return {};
        if (failure === "count") return { count: 502 };
        if (failure === "duplicate") return { data: [invoice(0)] };
        if (failure === "empty") return { data: [] };
        if (failure === "error") return { error: { message: "timeout" } };
        return { count: null };
      });
    await expect(getReconciledShiftDetail("shift-a")).rejects.toThrow();
  });

  it("accepts explicitly empty sources", async () => {
    const result = await getReconciledShiftDetail("shift-a");
    expect(result.invoices).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.summary.completedSales).toBe(0);
  });
});
