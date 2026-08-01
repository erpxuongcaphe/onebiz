import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error("[" + ctx + "] " + error.message);
  },
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-test-1",
    branchId: "branch-test-1",
    userId: "user-test-1",
  }),
}));

import {
  deleteCashTransaction,
  getCashBookSummary,
  getCashBookTypes,
} from "@/lib/services/supabase/cash-book";

describe("getCashBookTypes", () => {
  it("returns static type list", () => {
    const types = getCashBookTypes();
    expect(types.find((type) => type.value === "receipt")).toBeTruthy();
    expect(types.find((type) => type.value === "payment")).toBeTruthy();
  });
});

describe("getCashBookSummary", () => {
  it("returns zero totals as sync fallback", () => {
    expect(getCashBookSummary()).toEqual({ totalReceipt: 0, totalPayment: 0 });
  });
});

describe("deleteCashTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { cash_id: "tx-1" }, error: null });
  });

  it("cancels through the atomic server RPC without a client hard delete", async () => {
    await deleteCashTransaction("tx-1");

    expect(mockRpc).toHaveBeenCalledWith("cancel_cash_transaction", {
      p_cash_id: "tx-1",
      p_reason: "Hủy từ UI sổ quỹ",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection without a client fallback", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "CASH_TRANSACTION_ALREADY_CANCELLED" },
    });

    await expect(deleteCashTransaction("tx-1")).rejects.toThrow(
      "CASH_TRANSACTION_ALREADY_CANCELLED",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
