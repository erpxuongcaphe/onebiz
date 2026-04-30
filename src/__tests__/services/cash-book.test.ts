import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.insert = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = mockResult;
  chain.maybeSingle = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  // Multi-tenant safety + audit log helpers (cash-book service giờ dùng)
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-test-1",
    branchId: "branch-test-1",
    userId: "user-test-1",
  }),
}));

import {
  getCashBookTypes,
  getCashBookSummary,
  deleteCashTransaction,
} from "@/lib/services/supabase/cash-book";

describe("getCashBookTypes", () => {
  it("returns static type list", () => {
    const types = getCashBookTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types.find((t) => t.value === "receipt")).toBeTruthy();
    expect(types.find((t) => t.value === "payment")).toBeTruthy();
  });
});

describe("getCashBookSummary", () => {
  it("returns zero totals as sync fallback", () => {
    const summary = getCashBookSummary();
    expect(summary).toEqual({ totalReceipt: 0, totalPayment: 0 });
  });
});

describe("deleteCashTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a transaction by id", async () => {
    // .from().delete().eq() chain — eq returns chain which has no error
    // The actual code destructures { error } from the chain end
    (mockChain.eq as ReturnType<typeof vi.fn>).mockReturnValueOnce({ error: null });

    await deleteCashTransaction("tx-1");

    expect(mockFrom).toHaveBeenCalledWith("cash_transactions");
    expect(mockChain.delete).toHaveBeenCalled();
    expect(mockChain.eq).toHaveBeenCalledWith("id", "tx-1");
  });
});
