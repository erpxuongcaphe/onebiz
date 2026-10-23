import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => state,
  getCurrentContext: vi.fn(),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getPaymentHistory } from "@/lib/services/supabase/payments";

const row = (index: number) => ({
  id: `payment-${index}`, code: `PT${index}`, type: "receipt", amount: 100,
  payment_method: "cash", note: "Thu theo hoa don", created_at: "2026-10-22T01:00:00Z",
  transaction_date: "2026-10-22", status: index === 0 ? "cancelled" : "completed",
});
const page = (offset = 0, rows = [row(0)], total = rows.length) => ({
  reference_type: "invoice", reference_id: "invoice-a", branch_id: "branch-a",
  offset, limit: 200, total_count: total, rows,
});
beforeEach(() => vi.resetAllMocks());

describe("document payment history source", () => {
  it("loads every page and retains cancelled rows for audit", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => row(index));
    state.rpc.mockImplementation(async (_name, args) => ({ data: page(args.p_offset,
      rows.slice(args.p_offset, args.p_offset + args.p_limit), rows.length), error: null }));
    const result = await getPaymentHistory("invoice", "invoice-a");
    expect(result).toHaveLength(1201);
    expect(result[0].cancelled).toBe(true);
    expect(result[1200].id).toBe("payment-1200");
    expect(state.rpc).toHaveBeenCalledTimes(7);
    expect(state.rpc.mock.calls.every(([name]) => name === "get_document_payment_history_scoped")).toBe(true);
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each([
    null, { ...page(), reference_id: "other" }, { ...page(), reference_type: "purchase_order" },
    { ...page(), offset: 200 }, { ...page(), limit: 500 }, { ...page(), rows: null },
    { ...page(), total_count: null },
  ])("does not convert malformed responses into empty history", async (data) => {
    state.rpc.mockResolvedValue({ data, error: null });
    await expect(getPaymentHistory("invoice", "invoice-a")).rejects.toThrow("lịch sử thanh toán");
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each(["branch", "count", "duplicate", "incomplete"])("rejects changing pagination: %s", async (failure) => {
    state.rpc.mockResolvedValueOnce({ data: page(0, [row(0)], 2), error: null });
    const next = page(1, [row(1)], 2);
    if (failure === "branch") next.branch_id = "other";
    if (failure === "count") next.total_count = 3;
    if (failure === "duplicate") next.rows = [row(0)];
    if (failure === "incomplete") next.rows = [];
    state.rpc.mockResolvedValueOnce({ data: next, error: null });
    await expect(getPaymentHistory("invoice", "invoice-a")).rejects.toThrow();
  });

  it("keeps a denied request denied without direct-table fallback", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect(getPaymentHistory("invoice", "invoice-a")).rejects.toThrow("denied");
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.from).not.toHaveBeenCalled();
  });

  it("accepts an explicitly empty history", async () => {
    state.rpc.mockResolvedValue({ data: page(0, [], 0), error: null });
    expect(await getPaymentHistory("invoice", "invoice-a")).toEqual([]);
  });
});
