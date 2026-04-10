import { describe, it, expect, vi } from "vitest";

// Mock Supabase chain for dashboard queries
const mockSelect = vi.fn();
const mockGte = vi.fn();
const mockLt = vi.fn();

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
          { type: "receipt", amount: 1500000 },
          { type: "payment", amount: 400000 },
          { type: "payment", amount: 100000 },
        ]);
      }
      return createQueryChain(null);
    }),
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import { getDashboardKpis } from "@/lib/services/supabase/dashboard";

describe("getDashboardKpis", () => {
  it("calculates profit as revenue minus expenses (not 40% estimate)", async () => {
    const kpis = await getDashboardKpis();

    // Revenue: 1000000 + 500000 = 1500000
    // Expenses (payment type): 400000 + 100000 = 500000
    // Profit: 1500000 - 500000 = 1000000

    expect(kpis.todayRevenue).toBe(1500000);
    expect(kpis.todayProfit).toBe(1000000);
    // Verify it's NOT using 40% estimate (which would be 600000)
    expect(kpis.todayProfit).not.toBe(Math.round(1500000 * 0.4));
  });

  it("returns order count from completed invoices", async () => {
    const kpis = await getDashboardKpis();
    expect(kpis.todayOrders).toBe(2);
  });
});
