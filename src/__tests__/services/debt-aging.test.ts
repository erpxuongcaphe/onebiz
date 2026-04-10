import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Debt Aging Analysis Tests — Sprint 7 "Toàn Cảnh"
 *
 * Tests:
 *   - getDebtAging: bucket classification (0-30, 31-60, 61-90, 90+)
 *   - getDebtAging: total calculations
 *   - getTopDebtors: sorting by debt desc
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableDataMap: Record<string, any> = {};

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.in = vi.fn(self);
  chain.or = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  return chain;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      const mock = tableDataMap[table];
      return createChain(mock ?? { data: [], error: null });
    }),
    rpc: vi.fn(() => ({ data: null, error: null })),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({ tenantId: "t1", branchId: "b1", userId: "u1" })
  ),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 49 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import { getDebtAging, getTopDebtors } from "@/lib/services/supabase/debt";

beforeEach(() => {
  tableDataMap = {};
});

// ========================================
// getDebtAging
// ========================================

describe("getDebtAging", () => {
  it("classifies debts into correct aging buckets", async () => {
    const now = new Date();
    const daysAgo = (d: number) => {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString();
    };

    tableDataMap = {
      customers: {
        data: [
          { id: "c1", code: "KH01", name: "Cust 1", debt: 1_000_000 },
          { id: "c2", code: "KH02", name: "Cust 2", debt: 2_000_000 },
          { id: "c3", code: "KH03", name: "Cust 3", debt: 500_000 },
        ],
        error: null,
      },
      suppliers: {
        data: [
          { id: "s1", code: "NCC01", name: "Supp 1", debt: 3_000_000 },
        ],
        error: null,
      },
      invoices: {
        data: [
          { id: "inv1", customer_id: "c1", debt: 1_000_000, created_at: daysAgo(15), status: "completed" }, // 0-30
          { id: "inv2", customer_id: "c2", debt: 2_000_000, created_at: daysAgo(45), status: "completed" }, // 31-60
          { id: "inv3", customer_id: "c3", debt: 500_000, created_at: daysAgo(100), status: "completed" }, // 90+
        ],
        error: null,
      },
      purchase_orders: {
        data: [
          { id: "po1", supplier_id: "s1", debt: 3_000_000, created_at: daysAgo(75) }, // 61-90
        ],
        error: null,
      },
    };

    const result = await getDebtAging();

    // Check bucket classification
    expect(result.buckets[0].customerCount).toBe(1); // 0-30: c1
    expect(result.buckets[0].customerAmount).toBe(1_000_000);

    expect(result.buckets[1].customerCount).toBe(1); // 31-60: c2
    expect(result.buckets[1].customerAmount).toBe(2_000_000);

    expect(result.buckets[2].supplierCount).toBe(1); // 61-90: s1
    expect(result.buckets[2].supplierAmount).toBe(3_000_000);

    expect(result.buckets[3].customerCount).toBe(1); // 90+: c3
    expect(result.buckets[3].customerAmount).toBe(500_000);
  });

  it("calculates totals correctly", async () => {
    tableDataMap = {
      customers: {
        data: [
          { id: "c1", code: "KH01", name: "C1", debt: 1_000_000 },
          { id: "c2", code: "KH02", name: "C2", debt: 2_000_000 },
        ],
        error: null,
      },
      suppliers: {
        data: [
          { id: "s1", code: "NCC01", name: "S1", debt: 500_000 },
        ],
        error: null,
      },
      invoices: { data: [], error: null },
      purchase_orders: { data: [], error: null },
    };

    const result = await getDebtAging();

    expect(result.totalCustomerDebt).toBe(3_000_000);
    expect(result.totalSupplierDebt).toBe(500_000);
    expect(result.totalDebt).toBe(3_500_000);
    expect(result.customersWithDebt).toBe(2);
    expect(result.suppliersWithDebt).toBe(1);
  });

  it("returns empty report when no debt exists", async () => {
    tableDataMap = {
      customers: { data: [], error: null },
      suppliers: { data: [], error: null },
      invoices: { data: [], error: null },
      purchase_orders: { data: [], error: null },
    };

    const result = await getDebtAging();

    expect(result.totalDebt).toBe(0);
    expect(result.customersWithDebt).toBe(0);
    expect(result.suppliersWithDebt).toBe(0);
    result.buckets.forEach((b) => {
      expect(b.totalAmount).toBe(0);
    });
  });

  it("has 4 buckets with correct labels", async () => {
    tableDataMap = {
      customers: { data: [], error: null },
      suppliers: { data: [], error: null },
      invoices: { data: [], error: null },
      purchase_orders: { data: [], error: null },
    };

    const result = await getDebtAging();

    expect(result.buckets).toHaveLength(4);
    expect(result.buckets[0].range).toBe("0-30 ngày");
    expect(result.buckets[1].range).toBe("31-60 ngày");
    expect(result.buckets[2].range).toBe("61-90 ngày");
    expect(result.buckets[3].range).toBe("90+ ngày");
  });
});

// ========================================
// getTopDebtors
// ========================================

describe("getTopDebtors", () => {
  it("returns debtors sorted by debt descending", async () => {
    tableDataMap = {
      customers: {
        data: [
          { id: "c1", code: "KH01", name: "Small", phone: null, debt: 500_000 },
          { id: "c2", code: "KH02", name: "Big", phone: "0901234567", debt: 5_000_000 },
        ],
        error: null,
      },
      suppliers: {
        data: [
          { id: "s1", code: "NCC01", name: "Medium", phone: null, debt: 2_000_000 },
        ],
        error: null,
      },
      invoices: { data: [], error: null },
      purchase_orders: { data: [], error: null },
    };

    const result = await getTopDebtors(10);

    expect(result.length).toBe(3);
    expect(result[0].name).toBe("Big");
    expect(result[0].debt).toBe(5_000_000);
    expect(result[0].type).toBe("customer");

    expect(result[1].name).toBe("Medium");
    expect(result[1].debt).toBe(2_000_000);
    expect(result[1].type).toBe("supplier");

    expect(result[2].name).toBe("Small");
    expect(result[2].debt).toBe(500_000);
  });

  it("includes bucket labels for each debtor", async () => {
    const now = new Date();
    const daysAgo = (d: number) => {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString();
    };

    tableDataMap = {
      customers: {
        data: [
          { id: "c1", code: "KH01", name: "Old debt", phone: null, debt: 1_000_000 },
        ],
        error: null,
      },
      suppliers: { data: [], error: null },
      invoices: {
        data: [
          { customer_id: "c1", created_at: daysAgo(95) },
        ],
        error: null,
      },
      purchase_orders: { data: [], error: null },
    };

    const result = await getTopDebtors(10);
    expect(result[0].bucket).toBe("90+ ngày");
    expect(result[0].ageDays).toBeGreaterThanOrEqual(95);
  });
});
