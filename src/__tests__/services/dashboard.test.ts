import { describe, it, expect, vi } from "vitest";

const { overrides } = vi.hoisted(() => ({ overrides: {} as Record<string, unknown[]> }));

// Mock Supabase chain for dashboard queries

function createQueryChain(data: unknown[] | null, count?: number) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.eq = vi.fn(self);
  // Terminal: Promise.all resolves these chains
  chain.then = (resolve: (val: unknown) => void) => resolve({ data, count, error: null });
  return chain;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      if (overrides[table]) return createQueryChain(overrides[table]);
      if (table === "invoices") {
        return createQueryChain([
          { total: 1000000, discount_amount: 0, status: "completed" },
          { total: 500000, discount_amount: 0, status: "completed" },
        ]);
      }
      if (table === "customers") {
        return createQueryChain(null, 3);
      }
      if (table === "cash_transactions") {
        return createQueryChain([
          { type: "receipt", amount: 1200000, reference_type: "invoice" },
          { type: "receipt", amount: 9000000, status: "cancelled" },
          { type: "payment", amount: 400000 },
          { type: "payment", amount: 100000 },
        ]);
      }
      return createQueryChain(null);
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import { getDashboardKpis } from "@/lib/services/supabase/dashboard";

describe("getDashboardKpis", () => {
  it("calculates cash balance from valid receipts and payments rather than invoice revenue", async () => {
    const kpis = await getDashboardKpis();

    // Invoice revenue differs from cash received; cancelled receipts are excluded.

    expect(kpis.todayRevenue).toBe(1500000);
    expect(kpis.todayProfit).toBe(700000);
    expect(kpis.todayCollected).toBe(1200000);
    // Verify it's NOT using 40% estimate (which would be 600000)
    expect(kpis.todayProfit).not.toBe(Math.round(1500000 * 0.4));
  });

  it("keeps discounted invoice value separate from actual collections and refunds", async () => {
    overrides.invoices = [
      { total: 450000, discount_amount: 50000, status: "completed" },
      { total: 100000, discount_amount: 0, status: "draft" },
    ];
    overrides.cash_transactions = [
      { type: "receipt", amount: 300000, payment_method: "cash", reference_type: "invoice" },
      { type: "receipt", amount: 100000, payment_method: "transfer", reference_type: "invoice" },
      { type: "payment", amount: 20000, payment_method: "cash", reference_type: "sales_return" },
      { type: "receipt", amount: 999999, reference_type: "invoice", status: "cancelled" },
      { type: "receipt", amount: 777777, reference_type: "other" },
    ];
    try {
      const kpis = await getDashboardKpis("branch-1");
      expect(kpis.todayRevenue).toBe(450000);
      expect(kpis.todayDiscounts).toBe(50000);
      expect(kpis.todayCollected).toBe(380000);
      expect(kpis.todayCash).toBe(280000);
      expect(kpis.todayTransfer).toBe(100000);
      expect(kpis.todayRefunds).toBe(20000);
      expect(kpis.todayCash + kpis.todayTransfer + kpis.todayCard).toBe(kpis.todayCollected);
      expect(kpis.todayOrders).toBe(1);
    } finally {
      delete overrides.invoices;
      delete overrides.cash_transactions;
    }
  });

  it("returns order count from completed invoices", async () => {
    const kpis = await getDashboardKpis();
    expect(kpis.todayOrders).toBe(2);
  });
});
