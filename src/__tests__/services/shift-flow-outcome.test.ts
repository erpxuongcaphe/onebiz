import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn(), single: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: state.rpc, from: state.from }),
  getCurrentTenantId: state.tenant,
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { closeShift, getOpenShift, getAnyOpenShift, openFnbShift, reconcilePendingShift } from "@/lib/services/supabase/shifts";

const input = { shiftId: "test-shift", actualCash: 100, note: "Counted" };
const receipt = {
  shift_id: input.shiftId, actual_cash: 100, closed_at: "2026-10-22T12:00:00Z",
  cash_in: 200, cash_out: 100,
};
const row = { id: input.shiftId, tenant_id: "test-tenant", branch_id: "test-branch",
  cashier_id: "test-cashier", status: "closed", opened_at: "2026-10-22T01:00:00Z",
  closed_at: receipt.closed_at, actual_cash: 100, expected_cash: 100, cash_difference: 0,
  starting_cash: 0, total_sales: 100, total_orders: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  state.tenant.mockResolvedValue("test-tenant");
  const query = { select: state.select, eq: vi.fn(), limit: vi.fn(), single: state.single, maybeSingle: state.single };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  state.from.mockReturnValue(query);
  state.rpc.mockImplementation(async (name: string) => {
    if (name === "get_shift_context_scoped") {
      const response = await state.single();
      return { ...response, data: response.data ? { mode: "reconciliation", shift: response.data } : null };
    }
    return { data: receipt, error: null };
  });
  state.single.mockResolvedValue({ data: row, error: null });
});

describe("atomic shift outcome", () => {
  it("reports the confirmed close separately from report availability", async () => {
    const result = await closeShift(input);
    expect(result.shiftId).toBe(input.shiftId);
    expect(result.closedAt).toBe(receipt.closed_at);
    expect(result.report?.cashIn).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("close_shift_operational", {
      p_shift_id: input.shiftId, p_actual_cash: 100, p_note: "Counted",
    });
  });

  it.each(["query-error", "network", "missing", "stale", "masked", "different-count"])(
    "retains confirmed closed state when report load fails: %s", async (failure) => {
      if (failure === "query-error") state.single.mockResolvedValue({ data: null, error: { message: "denied" } });
      if (failure === "network") state.single.mockRejectedValue(new Error("offline"));
      if (failure === "session") state.tenant.mockRejectedValue(new Error("session expired"));
      if (failure === "missing") state.single.mockResolvedValue({ data: null, error: null });
      if (failure === "stale") state.single.mockResolvedValue({ data: { ...row, status: "open" }, error: null });
      if (failure === "masked") state.single.mockResolvedValue({ data: { ...row, total_sales: null }, error: null });
      if (failure === "different-count") state.single.mockResolvedValue({ data: { ...row, actual_cash: 999 }, error: null });
      expect(await closeShift(input)).toMatchObject({ shiftId: input.shiftId, actualCash: 100, report: null });
      expect(state.rpc.mock.calls.filter(([name]) => name === "close_shift_operational")).toHaveLength(1);
      expect(state.from).not.toHaveBeenCalled();
    },
  );

  it("does not re-read financial fields when the receipt contains only the blind acknowledgement", async () => {
    state.rpc.mockResolvedValue({ data: { shift_id: input.shiftId, closed_at: receipt.closed_at, actual_cash: 100 }, error: null });
    expect((await closeShift(input)).report).toBeNull();
    expect(state.from).not.toHaveBeenCalled();
  });

  it("uses the same confirmed-close result for pending-shift reconciliation", async () => {
    state.single.mockRejectedValue(new Error("report offline"));
    const result = await reconcilePendingShift({ ...input, reason: "Manager counted" });
    expect(result).toEqual({ shiftId: input.shiftId, closedAt: receipt.closed_at, actualCash: 100, report: null });
    expect(state.rpc).toHaveBeenCalledWith("reconcile_pending_shift", {
      p_shift_id: input.shiftId, p_actual_cash: 100, p_reason: "Manager counted", p_note: "Counted",
    });
  });

  it("does not guess success or repeat a close after a timeout", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "TIMEOUT", message: "timeout" } });
    await expect(closeShift(input)).rejects.toThrow("timeout");
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each([null, { ...receipt, shift_id: "wrong" }, { ...receipt, actual_cash: 101 },
    { ...receipt, closed_at: "bad-time" }])("requires an authoritative receipt before reporting success", async (data) => {
    state.rpc.mockResolvedValue({ data, error: null });
    await expect(closeShift(input)).rejects.toThrow("Chưa xác nhận");
    expect(state.from).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([-1, NaN, Infinity])("rejects invalid declared cash without a write", async (actualCash) => {
    await expect(closeShift({ ...input, actualCash })).rejects.toThrow("không hợp lệ");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("FnB open routing", () => {
  const open = { tenantId: "test-tenant", cashierId: "test-cashier", branchId: "test-branch", startingCash: 0 };
  it.each([
    { code: "42501", message: "permission denied for fnb_open_shift_atomic" },
    { code: "57014", message: "fnb_open_shift_atomic timeout" },
    { code: "PGRST200", message: "schema cache unavailable" },
    { code: "42883", message: "function unrelated_helper does not exist" },
  ])("does not reroute a real failure to Retail", async (error) => {
    state.rpc.mockResolvedValue({ data: null, error });
    await expect(openFnbShift(open)).rejects.toThrow(error.message);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][0]).toBe("open_shift_operational");
    expect(state.rpc.mock.calls[0][1].p_channel).toBe("fnb");
  });

  it("does not fall back to a legacy endpoint when migration is missing", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "RPC unavailable" } });
    await expect(openFnbShift(open)).rejects.toThrow("RPC unavailable");
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps opening responses operational even when an old server returns totals", async () => {
    state.rpc.mockResolvedValue({ data: { ...row, status: "open", total_sales: 9000, starting_cash: 2000 }, error: null });
    const shift = await openFnbShift(open);
    expect(shift.totalSales).toBeNull();
    expect(shift.startingCash).toBeNull();
    expect(shift.expectedCash).toBeNull();
    expect(shift.salesByMethod).toBeNull();
    expect(shift.id).toBe(input.shiftId);
  });
});

describe("operational shift reads", () => {
  it.each(["own", "active"])("does not request financial fields for %s shift status", async (scope) => {
    const active = { ...row, status: "open", cashier_name: "Test cashier" };
    state.rpc.mockResolvedValue({ data: { branch_id: "test-branch", own: active, active }, error: null });
    const result = scope === "own" ? await getOpenShift("test-branch", "test-cashier") : await getAnyOpenShift("test-branch");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("get_open_shift_status_scoped", { p_branch_id: "test-branch" });
    expect(state.from).not.toHaveBeenCalled();
    expect(result?.cashierName).toBe("Test cashier");
    expect(result?.id).toBe(input.shiftId);
    expect(result?.totalSales).toBeNull();
    expect(result?.totalOrders).toBeNull();
    expect(result?.cashDifference).toBeNull();
    expect(result?.startingCash).toBeNull();
  });

  it.each([
    { branch_id: "other", own: null },
    { branch_id: "test-branch" },
    { branch_id: "test-branch", own: { ...row, status: "open", cashier_id: "other" } },
  ])("rejects malformed or mismatched status instead of pretending no shift", async (data) => {
    state.rpc.mockResolvedValue({ data, error: null });
    await expect(getOpenShift("test-branch", "test-cashier")).rejects.toThrow("trạng thái ca");
    expect(state.from).not.toHaveBeenCalled();
  });

  it("returns no shift only for an explicit null", async () => {
    state.rpc.mockResolvedValue({ data: { branch_id: "test-branch", own: null }, error: null });
    expect(await getOpenShift("test-branch", "test-cashier")).toBeNull();
  });
});
