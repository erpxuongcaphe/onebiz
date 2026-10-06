import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), range: vi.fn(), eq: vi.fn(), lt: vi.fn(), gte: vi.fn(), lte: vi.fn(), neq: vi.fn(), in: vi.fn(), order: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mocks.from }),
  getCurrentTenantId: async () => "tenant-1",
  getCurrentContext: vi.fn(), getPaginationRange: vi.fn(),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getCashBookSummaryAsync } from "@/lib/services/supabase/cash-book";

beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: vi.fn(), ...mocks };
  for (const key of ["select", "eq", "lt", "gte", "lte", "neq", "in", "order"] as const) query[key].mockReturnValue(query);
  mocks.from.mockReturnValue(query);
});

describe("cash summary complete result", () => {
  it("includes rows beyond API's first page and independently pages opening balance", async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ type: "receipt", amount: "10" })), error: null })
      .mockResolvedValueOnce({ data: [{ type: "payment", amount: "25" }], error: null })
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ type: "receipt", amount: "2" })), error: null })
      .mockResolvedValueOnce({ data: [{ type: "payment", amount: "3" }], error: null });
    expect(await getCashBookSummaryAsync({ branchId: "xtb", dateFrom: "2026-10-01", dateTo: "2026-10-06" }))
      .toEqual({ totalReceipt: 10000, totalPayment: 25, openingBalance: 1997 });
    expect(mocks.range.mock.calls).toEqual([[0, 999], [1000, 1999], [0, 999], [1000, 1999]]);
    expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(mocks.eq).toHaveBeenCalledWith("branch_id", "xtb");
    expect(mocks.neq).toHaveBeenCalledWith("status", "cancelled");
    expect(mocks.lt).toHaveBeenCalledWith("transaction_date", "2026-10-01");
    expect(mocks.order).toHaveBeenCalledWith("id");
  });

  it("fails rather than returning an incomplete opening balance", async () => {
    mocks.range.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "Opening unavailable" } });
    await expect(getCashBookSummaryAsync({ dateFrom: "2026-10-01" })).rejects.toThrow("Opening unavailable");
  });

  it("keeps explicit statuses and zero opening for all-time totals", async () => {
    mocks.range.mockResolvedValueOnce({ data: [{ type: "receipt", amount: 12 }, { type: "payment", amount: 5 }], error: null });
    expect(await getCashBookSummaryAsync({ statuses: ["completed"] })).toEqual({ totalReceipt: 12, totalPayment: 5, openingBalance: 0 });
    expect(mocks.in).toHaveBeenCalledWith("status", ["completed"]);
    expect(mocks.neq).not.toHaveBeenCalled();
    expect(mocks.range).toHaveBeenCalledTimes(1);
  });
});
