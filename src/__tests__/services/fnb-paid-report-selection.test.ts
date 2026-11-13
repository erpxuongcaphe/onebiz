import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as Array<{ table: string; filters: Array<[string, string, unknown]>; select: string }>, rpcCalls: [] as Array<{name: string; args: Record<string, unknown>}>, rpcData: [{product_name:"Coffee",quantity:"2",revenue:"112000"}] as unknown }));
const orders = [
  { id: "served", invoice_id: "invoice-served", status: "served", branch_id: "branch", tenant_id: "tenant", order_type: "delivery", delivery_platform: "Grab", table_id: "table", restaurant_tables: { name: "Table 1" }, invoices: { total: 65000, status: "completed", source: "fnb", ngay_chung_tu: "2026-10-07T08:00:00Z" } },
  { id: "done", invoice_id: "invoice-done", status: "completed", branch_id: "branch", tenant_id: "tenant", order_type: "delivery", delivery_platform: "Grab", table_id: "table", restaurant_tables: { name: "Table 1" }, invoices: { total: 47000, status: "completed", source: "fnb", ngay_chung_tu: "2026-10-07T08:00:00Z" } },
];
const kitchenRows = [
  ...orders,
  { ...orders[0], id: "void", invoices: { ...orders[0].invoices, status: "cancelled" } },
  { ...orders[0], id: "draft", invoices: { ...orders[0].invoices, status: "draft" } },
  { ...orders[0], id: "retail", invoices: { ...orders[0].invoices, source: "retail" } },
  { ...orders[0], id: "other", branch_id: "other" },
  { ...orders[0], id: "other-tenant", tenant_id: "other" },
];
const itemRows = kitchenRows.map((row) => ({
  kitchen_order_id: row.id, quantity: 1, product_name: "Coffee", product_id: "coffee",
  unit_price: row.invoices.total, products: { category_id: "drinks", product_categories: { name: "Drinks" } },
  modifier_selections: [{ groupId: "sugar", groupName: "Sugar", options: [{ optionId: "less", label: "Less", priceDelta: 0 }] }],
}));

vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant",
  handleError: (error: Error) => { throw error; },
  getClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({name,args});
    return {data:name === "staff_fnb_table_summary" ? [{table_name:"Table 1",revenue:"112000",orders:"2"}] :
      name === "staff_fnb_hour_summary" ? Array.from({length:24},(_,hour)=>({hour,revenue:hour===15?"112000":"0",orders:hour===15?"2":"0"})) :
      name === "staff_fnb_channel_summary" ? [{dimension:args.p_dimension==="platform"?"Grab":"delivery",revenue:"112000",orders:"2"}] :
      name === "staff_fnb_turnover_summary" ? [{table_name:"Table 1",avg_minutes:"20",orders:"2"}] :
      name === "staff_fnb_category_summary" ? [{category_name:"Drinks",revenue:"112000",orders:"2",quantity:"2"}] :
      name === "staff_fnb_modifier_summary" ? [{group_id:"sugar",group_name:"Sugar",option_id:"less",option_label:"Less",selection_count:"2",total_quantity:"2",total_price_delta:"0",percent_in_group:"100"}] : state.rpcData,error:null};
  }, from: (table: string) => {
    const query = { table, filters: [] as Array<[string, string, unknown]>, select: "" };
    state.queries.push(query);
    const value = (row: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], row);
    const chain = {
      select: (fields: string) => { query.select = fields; return chain; },
      eq: (key: string, expected: unknown) => { query.filters.push(["eq", key, expected]); return chain; },
      not: (key: string, _op: string, expected: unknown) => { query.filters.push(["not", key, expected]); return chain; },
      in: (key: string, expected: unknown[]) => { query.filters.push(["in", key, expected]); return chain; },
      gte: (key: string, expected: unknown) => { query.filters.push(["gte", key, expected]); return chain; },
      lt: (key: string, expected: unknown) => { query.filters.push(["lt", key, expected]); return chain; },
      order: () => chain,
      range: async (from: number, to: number) => ({ error: null, data: (table === "kitchen_orders" ? kitchenRows : itemRows).filter(row => query.filters.every(([op, key, expected]) => {
        const actual = value(row, key);
        if (op === "eq") return actual === expected;
        if (op === "not") return actual != expected;
        if (op === "in") return (expected as unknown[]).includes(actual);
        if (op === "gte") return String(actual) >= String(expected);
        return String(actual) < String(expected);
      })).slice(from, to + 1) }),
    };
    return chain;
  } }),
}));

import { getModifierStats, getRevenueByCategory, getRevenueByHourFnb, getRevenueByMenuItem, getRevenueByOrderType, getRevenueByPlatform, getRevenueByTable, getTableTurnover } from "@/lib/services/supabase/fnb-analytics";

beforeEach(() => { state.queries.length = 0; state.rpcCalls.length = 0; state.rpcData = [{product_name:"Coffee",quantity:"2",revenue:"112000"}]; });

describe("F&B revenue uses completed invoices independently of kitchen status", () => {
  it("reads product category totals without individual orders", async () => {
    expect(await getRevenueByCategory("branch")).toEqual([{categoryName:"Drinks",revenue:112000,orders:2,quantity:2}]);
    expect(state.rpcCalls[0]).toEqual({name:"staff_fnb_category_summary",args:{p_branch_id:"branch"}});
    expect(state.queries).toHaveLength(0);
  });

  it("reads order type and delivery platform as scoped totals", async () => {
    expect(await getRevenueByOrderType("branch")).toEqual([{orderType:"delivery",orderTypeLabel:"Giao hàng",revenue:112000,orders:2}]);
    expect(await getRevenueByPlatform("branch")).toEqual([{platform:"Grab",revenue:112000,orders:2}]);
    expect(state.queries).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(2);
  });

  it("reads table service time as a scoped aggregate", async () => {
    expect(await getTableTurnover("branch")).toEqual([{tableName:"Table 1",avgMinutes:20,orders:2}]);
    expect(state.rpcCalls[0]).toEqual({name:"staff_fnb_turnover_summary",args:{p_branch_id:"branch"}});
    expect(state.queries).toHaveLength(0);
  });

  it("reads menu aggregates without exposing individual orders", async () => {
    expect(await getRevenueByMenuItem("branch")).toEqual([{productName:"Coffee",quantity:2,revenue:112000}]);
    expect(state.rpcCalls).toEqual([{name:"staff_fnb_menu_summary",args:{p_branch_id:"branch",p_from:null,p_to:null,p_limit:15}}]);
    expect(state.queries).toHaveLength(0);
  });

  it("reads table aggregates without exposing individual bills", async () => {
    expect(await getRevenueByTable("branch")).toEqual([{tableName:"Table 1",revenue:112000,orders:2}]);
    expect(state.rpcCalls).toEqual([{name:"staff_fnb_table_summary",args:{p_branch_id:"branch",p_from:null,p_to:null}}]);
    expect(state.queries).toHaveLength(0);
  });

  it("reads all 24 Vietnam-hour totals without individual bills", async () => {
    const rows=await getRevenueByHourFnb("branch");
    expect(rows).toHaveLength(24);
    expect(rows[15]).toEqual({hour:15,label:"15h",revenue:112000,orders:2});
    expect(state.queries).toHaveLength(0);
  });

  it("sends the selected invoice business-day window to the menu aggregate", async () => {
    await getRevenueByMenuItem("branch",15,{from:"2026-10-07",to:"2026-10-07"});
    expect(state.rpcCalls[0].args).toMatchObject({p_branch_id:"branch",p_from:"2026-10-06T17:00:00.000Z",p_to:"2026-10-07T17:00:00.000Z"});
  });

  it("sends the selected invoice business-day window to the table aggregate", async () => {
    await getRevenueByTable("branch",{from:"2026-10-07",to:"2026-10-07"});
    expect(state.rpcCalls[0].args).toMatchObject({p_branch_id:"branch",p_from:"2026-10-06T17:00:00.000Z",p_to:"2026-10-07T17:00:00.000Z"});
  });

  it("sends invoice business-day bounds to modifier aggregation", async () => {
    await getModifierStats("branch",{from:"2026-10-07",to:"2026-10-07"});
    expect(state.rpcCalls[0]).toEqual({name:"staff_fnb_modifier_summary",args:{
      p_branch_id:"branch",p_from:"2026-10-06T17:00:00.000Z",p_to:"2026-10-07T17:00:00.000Z",
    }});
  });

  it("does not show an invalid aggregate as a valid report", async () => {
    state.rpcData = [{product_name:"Coffee",quantity:null,revenue:"not-a-number"}];
    await expect(getRevenueByMenuItem("branch")).rejects.toThrow("Dữ liệu tổng hợp món F&B chưa hợp lệ");
  });

  it("includes paid served modifier selections", async () => {
    const rows = await getModifierStats("branch");
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(state.rpcCalls[0].name).toBe("staff_fnb_modifier_summary");
    expect(state.queries).toHaveLength(0);
  });

});
