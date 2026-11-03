import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { customer_id: string | null; tenant_id: string; branch_id: string; status: string; ngay_chung_tu: string; customers: { group_id: string | null; customer_groups: { name: string | null } | null } };
const state = vi.hoisted(() => ({ rows: [] as Row[], error: false,
  requests: [] as Array<{ select: string; filters: Array<[string, unknown]>; range: number[] }> }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-test",
  handleError: (error: Error) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    expect(table).toBe("invoices");
    const request = { select: "", filters: [] as Array<[string, unknown]>, range: [] as number[] };
    let fromDate: string | undefined, toDate: string | undefined;
    const chain = {
      select: (value: string) => { request.select = value; return chain; },
      eq: (field: string, value: unknown) => { request.filters.push([field, value]); return chain; },
      gte: (field: string, value: string) => { expect(field).toBe("ngay_chung_tu"); fromDate=value; return chain; },
      lt: (field: string, value: string) => { expect(field).toBe("ngay_chung_tu"); toDate=value; return chain; },
      not: () => chain,
      order: () => chain,
      range: async (from: number, to: number) => {
        request.range = [from, to]; state.requests.push(request);
        const rows = state.rows.filter(row => row.customer_id !== null && request.filters.every(([field, value]) => row[field as keyof Row] === value)
          && (!fromDate || Date.parse(row.ngay_chung_tu)>=Date.parse(fromDate))
          && (!toDate || Date.parse(row.ngay_chung_tu)<Date.parse(toDate)));
        return { data: rows.slice(from, to + 1), error: state.error ? new Error("SEGMENT_READ_DENIED") : null };
      },
    };
    return chain;
  } }),
}));
vi.mock("@/lib/services/supabase/branch-stock", () => ({ getBranchStockAggregates: vi.fn(), getBranchStockRows: vi.fn() }));
vi.mock("@/lib/services/supabase/reports", () => ({ getProfitAndLoss: vi.fn(), getConsolidatedPnL: vi.fn() }));
import { getCustomerSegments } from "@/lib/services/supabase/analytics";

function row(id: string, name: string | null, branch = "branch-a"): Row {
  return { customer_id: id, tenant_id: "tenant-test", branch_id: branch, status: "completed", ngay_chung_tu: "2026-10-01T00:00:00+07:00",
    customers: { group_id: name ? "00000000-0000-0000-0000-000000000050" : null,
      customer_groups: name === null ? null : { name } } };
}
beforeEach(() => { state.rows = []; state.requests = []; state.error = false; });

describe("customer report group labels", () => {
  it("reads actual group names rather than matching UUIDs to fixed English IDs", async () => {
    state.rows = [row("c1", "Wholesale B2B"), row("c2", "Loyalty VIP")];
    expect(await getCustomerSegments("branch-a")).toEqual([
      { name: "Wholesale B2B", value: 1 }, { name: "Loyalty VIP", value: 1 },
    ]);
    expect(state.requests[0].select).toBe("customer_id, customers!inner(group_id, customer_groups!customers_group_id_fkey(name))");
    expect(state.requests[0].select).not.toMatch(/debt|cost|total_spent/);
  });

  it("distinguishes unclassified customers from an actual retail group", async () => {
    state.rows = [row("c1", null), row("c2", "Khách lẻ"), row("c3", "  ")];
    expect(await getCustomerSegments()).toEqual([{ name: "Chưa phân nhóm", value: 1 }, { name: "Khách lẻ", value: 1 }, { name: "Chưa xác định nhóm", value: 1 }]);
  });

  it("does not call an assigned but unreadable group unclassified", async () => {
    const assigned = row("c1", "Hidden group");
    assigned.customers.customer_groups = null;
    state.rows = [assigned];
    expect(await getCustomerSegments()).toEqual([{ name: "Chưa xác định nhóm", value: 1 }]);
  });

  it("counts each customer once even with multiple invoices", async () => {
    state.rows = [row("c1", "Partners"), row("c1", "Partners"), row("c2", "Partners")];
    expect(await getCustomerSegments()).toEqual([{ name: "Partners", value: 2 }]);
  });

  it("retains tenant, completed-state and branch filters", async () => {
    state.rows = [row("c1", "A"), row("c2", "B", "branch-b"), { ...row("c3", "Foreign"), tenant_id: "foreign" }, { ...row("c4", "Draft"), status: "draft" }];
    expect(await getCustomerSegments("branch-a")).toEqual([{ name: "A", value: 1 }]);
    expect(state.requests[0].filters).toEqual([["tenant_id", "tenant-test"], ["status", "completed"], ["branch_id", "branch-a"]]);
  });

  it("does not force an operational branch for the existing all-branch reader", async () => {
    state.rows = [row("c1", "A"), row("c2", "B", "branch-b")];
    expect(await getCustomerSegments()).toHaveLength(2);
    expect(state.requests[0].filters.some(([field]) => field === "branch_id")).toBe(false);
  });

  it("keeps all pages and deduplicates a customer repeated on a later page", async () => {
    state.rows = [...Array.from({ length: 1201 }, (_, index) => row(`c${index}`, "Named group")), row("c0", "Named group")];
    expect(await getCustomerSegments("branch-a")).toEqual([{ name: "Named group", value: 1201 }]);
    expect(state.requests.some(request => request.range[0] > 0)).toBe(true);
  });

  it("propagates a denied read rather than inventing a default group", async () => {
    state.error = true;
    await expect(getCustomerSegments("branch-a")).rejects.toThrow("SEGMENT_READ_DENIED");
  });

  it("returns no categories for an empty result", async () => {
    expect(await getCustomerSegments("branch-a")).toEqual([]);
  });

  it("uses the selected inclusive dates and excludes the next local midnight", async () => {
    state.rows = [
      { ...row("old", "Before"), ngay_chung_tu: "2026-09-30T23:59:59+07:00" },
      row("first", "October"),
      { ...row("last", "October"), ngay_chung_tu: "2026-10-31T23:59:59+07:00" },
      { ...row("next", "November"), ngay_chung_tu: "2026-11-01T00:00:00+07:00" },
    ];
    expect(await getCustomerSegments("branch-a", { from: "2026-10-01", to: "2026-10-31" })).toEqual([{ name: "October", value: 2 }]);
    expect(await getCustomerSegments("branch-a", { from: "2026-11-01", to: "2026-11-01" })).toEqual([{ name: "November", value: 1 }]);
  });
});
