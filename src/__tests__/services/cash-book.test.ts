import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.insert = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.update = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = mockResult;
  chain.maybeSingle = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);
const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
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

vi.mock("@/lib/services/supabase/audit", () => ({
  recordAuditLog: vi.fn(),
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

  it("cancels a free-form transaction by id without hard delete", async () => {
    mockResult.mockResolvedValueOnce({
      data: {
        code: "PT00001",
        type: "receipt",
        category: "Khác",
        amount: 100000,
        counterparty: null,
        reference_type: null,
        reference_id: null,
        status: "active",
        note: null,
      },
      error: null,
    });

    await deleteCashTransaction("tx-1");

    expect(mockFrom).toHaveBeenCalledWith("cash_transactions");
    expect(mockChain.delete).not.toHaveBeenCalled();
    expect(mockChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
    expect(mockChain.eq).toHaveBeenCalledWith("id", "tx-1");
  });
});
