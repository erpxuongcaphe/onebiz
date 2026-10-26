import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
type Query = { table: string; columns: string; filters: Array<[string, unknown]>; orders: string[]; from: number; to: number; exact: boolean };
const fake = vi.hoisted(() => ({
  rows: [] as Row[], queries: [] as Query[],
  partners: [] as Row[],
  failOffset: -1, missingSettlement: false, changedCount: false,
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-fixture",
  getPaginationRange: () => ({ from: 0, to: 19 }),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ from: (table: string) => {
    const state: Query = { table, columns: "", filters: [], orders: [], from: 0, to: 199, exact: false };
    const chain = {
      select(columns: string, options?: { count?: string }) { state.columns = columns; state.exact = options?.count === "exact"; return chain; },
      eq(key: string, value: unknown) { state.filters.push([key, value]); return chain; },
      ilike(key: string, value: unknown) { state.filters.push([key, value]); return chain; },
      is(key: string, value: unknown) { state.filters.push([key, value]); return chain; },
      order(key: string) { state.orders.push(key); return chain; },
      range(from: number, to: number) { state.from = from; state.to = to; return chain; },
      then(resolve: (result: unknown) => unknown) {
        fake.queries.push({ ...state, filters: [...state.filters], orders: [...state.orders] });
        if (table === "delivery_partners") return Promise.resolve({ data: fake.partners.slice(state.from, state.to + 1), count: fake.partners.length, error: null }).then(resolve);
        if (fake.missingSettlement && state.columns.includes("settlement_id")) return Promise.resolve({ data: null, error: { code: "42703", message: "Missing column" } }).then(resolve);
        if (state.from === fake.failOffset) return Promise.resolve({ data: null, error: { message: "Page unavailable" } }).then(resolve);
        return Promise.resolve({ data: fake.rows.slice(state.from, state.to + 1), count: fake.rows.length + (fake.changedCount && state.from > 0 ? 1 : 0), error: null }).then(resolve);
      },
    };
    return chain;
  } }),
}));

import { getDeliveryPartnersWithStats, getUnsettledShipments } from "@/lib/services/supabase/shipping";

beforeEach(() => {
  fake.rows = []; fake.queries = []; fake.failOffset = -1;
  fake.partners = [{ id: "partner", name: "Fixture" }];
  fake.missingSettlement = false; fake.changedCount = false;
});

describe("COD complete read pagination", () => {
  it("aggregates more than 1000 shipments without including settled COD", async () => {
    fake.rows = Array.from({ length: 1001 }, (_, i) => ({ id: `row-${i}`, partner_id: "partner", status: "delivered", cod_amount: 10, shipping_fee: 2, settlement_id: i === 1000 ? "settled" : null }));
    const result = await getDeliveryPartnersWithStats({ page: 0, pageSize: 20 }, { branchId: "branch-fixture" });
    expect(result.data[0].stats).toMatchObject({ deliveredOrders: 1001, codHolding: 10000, feeCollected: 2000 });
    const pages = fake.queries.filter(q => q.table === "shipping_orders");
    expect(pages).toHaveLength(6);
    for (const page of pages) {
      expect(page.exact).toBe(true);
      expect(page.filters).toEqual([["tenant_id", "tenant-fixture"], ["invoices.branch_id", "branch-fixture"]]);
      expect(page.orders).toEqual(["id"]);
    }
  });

  it("keeps unassigned shipments separate and supports an empty result", async () => {
    fake.rows = [{ id: "unassigned", partner_id: null, status: "delivered", cod_amount: 25, shipping_fee: 3 }];
    const result = await getDeliveryPartnersWithStats({ page: 0, pageSize: 20 });
    expect(result.unassigned.codHolding).toBe(25);
    expect(result.data[0].stats.codHolding).toBe(0);
    fake.rows = [];
    expect((await getUnsettledShipments(null)).length).toBe(0);
  });

  it("paginates the compatibility query with the same branch scope", async () => {
    fake.missingSettlement = true;
    fake.rows = Array.from({ length: 201 }, (_, i) => ({ id: `legacy-${i}`, partner_id: "partner", status: "pending" }));
    const result = await getDeliveryPartnersWithStats({ page: 0, pageSize: 20 }, { branchId: "branch-fixture" });
    expect(result.data[0].stats.activeOrders).toBe(201);
    const pages = fake.queries.filter(q => q.table === "shipping_orders");
    expect(pages).toHaveLength(3);
    expect(pages.every(q => q.filters.some(([key, value]) => key === "invoices.branch_id" && value === "branch-fixture"))).toBe(true);
  });

  it.each(["partner", null])("reads all unsettled shipments for %s with stable ordering", async partner => {
    fake.rows = Array.from({ length: 1001 }, (_, i) => ({ id: `row-${i}`, code: `VD-${i}`, cod_amount: 10, updated_at: "2026-10-01T00:00:00Z", invoices: { code: "HD-fixture", customer_name: "Fixture", debt: 10, status: "completed" } }));
    const result = await getUnsettledShipments(partner, "branch-fixture");
    expect(result).toHaveLength(1001);
    expect(result[1000].code).toBe("VD-1000");
    for (const page of fake.queries) {
      expect(page.exact).toBe(true);
      expect(page.orders).toEqual(["updated_at", "id"]);
      expect(page.filters).toEqual(expect.arrayContaining([["tenant_id", "tenant-fixture"], ["status", "delivered"], ["settlement_id", null], ["invoices.branch_id", "branch-fixture"], ["partner_id", partner]]));
    }
  });

  it.each(["stats", "unsettled"])("rejects a failed later page instead of returning partial %s", async kind => {
    fake.rows = Array.from({ length: 201 }, (_, i) => ({ id: `row-${i}` }));
    fake.failOffset = 200;
    await expect(kind === "stats" ? getDeliveryPartnersWithStats({ page: 0, pageSize: 20 }) : getUnsettledShipments(null)).rejects.toThrow("Page unavailable");
  });

  it("caps collectable COD to invoice debt without discarding the declared amount", async () => {
    fake.rows = [{ id: "row-cap", code: "VD-cap", cod_amount: 100, updated_at: "2026-10-01T00:00:00Z", invoices: { code: "HD-cap", customer_name: "Fixture", debt: 60, status: "completed" } }];
    expect((await getUnsettledShipments("partner", "branch-fixture"))[0]).toMatchObject({ codAmount: 60, declaredCodAmount: 100 });
    expect(fake.queries[0].filters).toContainEqual(["invoices.status", "completed"]);
  });

  it("rejects changing totals and duplicate pages", async () => {
    fake.rows = Array.from({ length: 201 }, (_, i) => ({ id: `row-${i}` }));
    fake.changedCount = true;
    await expect(getUnsettledShipments(null)).rejects.toThrow("Số dòng lịch sử thay đổi");
    fake.changedCount = false;
    fake.rows[200].id = "row-0";
    await expect(getUnsettledShipments(null)).rejects.toThrow("Lịch sử thay đổi");
  });

  it("keeps the schema hint for unsettled shipments instead of returning an empty selection", async () => {
    fake.missingSettlement = true;
    await expect(getUnsettledShipments("partner")).rejects.toThrow("migration 00301");
  });

  it("loads every partner for the full workspace with exact count and stable ordering", async () => {
    fake.partners = Array.from({ length: 1001 }, (_, i) => ({ id: `partner-${i}`, name: "Fixture" }));
    const result = await getDeliveryPartnersWithStats({ page: 0, pageSize: 100, fetchAll: true, search: "Fixture" });
    expect(result.data).toHaveLength(1001);
    const pages = fake.queries.filter(q => q.table === "delivery_partners");
    expect(pages).toHaveLength(6);
    for (const page of pages) {
      expect(page.exact).toBe(true);
      expect(page.orders).toEqual(["created_at", "id"]);
      expect(page.filters).toEqual([["tenant_id", "tenant-fixture"], ["name", "%Fixture%"]]);
    }
  });

  it.each([null, "", "bad", false, -1, Infinity])("rejects an invalid COD amount %s", async amount => {
    fake.rows = [{ id: "invalid", partner_id: "partner", status: "delivered", settlement_id: null, cod_amount: amount, shipping_fee: 0 }];
    await expect(getDeliveryPartnersWithStats({ page: 0, pageSize: 20 })).rejects.toThrow();
    await expect(getUnsettledShipments("partner")).rejects.toThrow();
  });
});
