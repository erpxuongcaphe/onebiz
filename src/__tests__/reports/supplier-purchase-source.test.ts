import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, reads: [] as { table: string; filters: [string,string,unknown][]; select: string }[] }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-fixture",
  handleError: (error: Error) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    const read = { table, filters: [] as [string,string,unknown][], select: "" };
    const q = {
      select: (columns: string) => { read.select = columns; return q; },
      eq: (key: string, value: unknown) => { read.filters.push(["eq",key,value]); return q; },
      gte: (key: string, value: unknown) => { read.filters.push(["gte",key,value]); return q; },
      lt: (key: string, value: unknown) => { read.filters.push(["lt",key,value]); return q; },
      order: () => q,
      range: async (from: number, to: number) => { state.reads.push(read); return { data: (state.rows[table] ?? []).slice(from,to+1), error: null }; },
    };
    return q;
  } }),
}));
import { getSupplierKpis } from "@/lib/services/supabase/analytics";

beforeEach(() => { state.rows = {}; state.reads = []; });
describe("supplier purchase source", () => {
  it("uses timestamp instants at the business-day boundary, not lexical timezone strings", async () => {
    state.rows.supplier_returns = [
      {id:"start",total:10,created_at:"2026-09-30T17:00:00+00:00"},
      {id:"before",total:20,created_at:"2026-09-30T16:59:59+00:00"},
      {id:"end",total:40,created_at:"2026-10-04T00:00:00+07:00"},
    ];
    expect(await getSupplierKpis("branch",{from:"2026-10-01",to:"2026-10-03"})).toMatchObject({returnCount:1,returnAmount:10,prevReturnAmount:20});
  });
  it("keeps current and comparison returns separate and excludes the next date boundary", async () => {
    state.rows.purchase_orders = [
      { supplier_id: "supplier", total: 100, debt: 10, created_at: "2026-10-02T00:00:00.000Z" },
      { supplier_id: "supplier", total: 200, debt: 0, created_at: "2026-09-28T00:00:00.000Z" },
    ];
    state.rows.supplier_returns = [
      { id: "current", total: "30", created_at: "2026-10-02T00:00:00.000Z" },
      { id: "prior", total: 20, created_at: "2026-09-28T00:00:00.000Z" },
      { id: "next", total: 900, created_at: "2026-10-03T17:00:00.000Z" },
    ];
    const result = await getSupplierKpis("branch-fixture", { from: "2026-10-01", to: "2026-10-03" });
    expect(result).toMatchObject({ purchaseThisMonth: 100, prevPurchase: 200, returnCount: 1, returnAmount: 30, prevReturnAmount: 20, netPurchase: 70, prevNetPurchase: 180 });
    for (const read of state.reads) {
      expect(read.filters).toContainEqual(["eq","tenant_id","tenant-fixture"]);
      expect(read.filters).toContainEqual(["eq","branch_id","branch-fixture"]);
      expect(read.filters).toContainEqual(["eq","status","completed"]);
    }
    expect(state.reads.find(read => read.table === "supplier_returns")?.select).toContain("total");
  });
  it("loads all return pages rather than truncating the total to one page", async () => {
    state.rows.supplier_returns = Array.from({length:1001},(_,i)=>({id:String(i),total:1,created_at:"2026-10-02T00:00:00.000Z"}));
    const result = await getSupplierKpis(undefined,{from:"2026-10-01",to:"2026-10-03"});
    expect(result).toMatchObject({returnCount:1001,returnAmount:1001,netPurchase:-1001});
    expect(state.reads.filter(read => read.table === "supplier_returns")).toHaveLength(2);
  });
});
