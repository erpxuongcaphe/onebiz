import { describe, expect, it, vi } from "vitest";

const { from, chain } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "gte", "lte", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.range = vi.fn(async () => ({
    data: [
      {
        transaction_date: "2026-08-31",
        created_at: "2026-09-02T12:00:00Z",
        type: "receipt",
        amount: "150000",
        category: "Bán hàng",
      },
      {
        transaction_date: "2026-09-01",
        created_at: "2026-09-01T12:00:00Z",
        type: "payment",
        amount: "25000",
        category: "Vận hành",
      },
    ],
    error: null,
  }));
  return { from: vi.fn(() => query), chain: query };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));

import { getCashFlowDetailed } from "@/lib/services/supabase/analytics";

describe("cash-flow detail", () => {
  it("uses voucher date like the cash book, not record creation time", async () => {
    const rows = await getCashFlowDetailed(2, "branch-1", {
      from: "2026-08-01",
      to: "2026-09-30",
    });

    expect(from).toHaveBeenCalledWith("cash_transactions");
    expect(chain.select).toHaveBeenCalledWith("transaction_date, type, amount, category");
    expect(chain.eq).toHaveBeenCalledWith("status", "completed");
    expect(chain.eq).toHaveBeenCalledWith("branch_id", "branch-1");
    expect(chain.gte).toHaveBeenCalledWith("transaction_date", "2026-08-01");
    expect(chain.lte).toHaveBeenCalledWith("transaction_date", "2026-09-30");
    expect(chain.order).toHaveBeenCalledWith("transaction_date", { ascending: true });
    expect(rows).toMatchObject([
      { month: "T8/2026", totalReceipt: 150000, totalPayment: 0, cumulativeBalance: 150000 },
      { month: "T9/2026", totalReceipt: 0, totalPayment: 25000, cumulativeBalance: 125000 },
    ]);
  });
});
