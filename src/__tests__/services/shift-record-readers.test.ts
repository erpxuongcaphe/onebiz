import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => api, getCurrentTenantId: async () => "tenant-a",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getPendingShifts, getShiftHistory } from "@/lib/services/supabase/shifts";

const row = (index: number) => ({ id: `shift-${index}`, tenant_id: "tenant-a", branch_id: "branch-a",
  branch_name: "Demo", cashier_id: "actor-a", cashier_name: "Demo", status: "pending_reconcile",
  opened_at: "2026-10-23T01:00:00Z", closed_at: null, note: null,
  starting_cash: 100, auto_marked_pending_at: "2026-10-23T02:00:00Z" });
const page = (offset = 0, rows: Record<string, unknown>[] = [row(0)], total = rows.length) => ({
  kind: "pending", mode: "reconciliation", tenant_id: "tenant-a", actor_id: "actor-a", branch_id: "branch-a",
  as_of: "2026-10-23T03:00:00Z", offset, limit: 200, revision: "revision-a", total_count: total, rows,
});
beforeEach(() => vi.resetAllMocks());

describe("pending shift source", () => {
  it("loads 1201 rows and uses server time for shift duration", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => row(index));
    api.rpc.mockImplementation(async (_name, args) => ({ data: page(args.p_offset,
      rows.slice(args.p_offset, args.p_offset + args.p_limit), rows.length), error: null }));
    const result = await getPendingShifts("branch-a");
    expect(result).toHaveLength(1201);
    expect(result[0].shiftDurationHours).toBe(2);
    expect(result[0].startingCash).toBe(100);
    expect(api.rpc).toHaveBeenCalledTimes(7);
    expect(api.rpc.mock.calls.every(([name]) => name === "get_shift_records_scoped")).toBe(true);
    expect(api.from).not.toHaveBeenCalled();
  });
  it("delegates all-assigned-branches selection to the server", async () => {
    api.rpc.mockResolvedValue({ data: { ...page(), branch_id: null }, error: null });
    expect(await getPendingShifts()).toHaveLength(1);
    expect(api.rpc.mock.calls[0][1].p_branch_id).toBeNull();
  });
  it("preserves a missing automatic marking time as unknown", async () => {
    api.rpc.mockResolvedValue({ data: page(0, [{ ...row(0), auto_marked_pending_at: null }]), error: null });
    expect((await getPendingShifts("branch-a"))[0].autoMarkedPendingAt).toBeNull();
  });
  it.each([null, { ...page(), mode: "blind" }, { ...page(), tenant_id: "other" },
    { ...page(), branch_id: "other" }, { ...page(), as_of: null },
    page(0, [{ ...row(0), status: "closed" }]), page(0, [{ ...row(0), starting_cash: null }]),
  ])("does not turn invalid responses into a healthy empty queue", async data => {
    api.rpc.mockResolvedValue({ data, error: null });
    await expect(getPendingShifts("branch-a")).rejects.toThrow();
  });
  it.each(["revision", "actor", "duplicate", "empty"])("rejects changing pagination: %s", async failure => {
    api.rpc.mockResolvedValueOnce({ data: page(0, [row(0)], 2), error: null });
    const next = page(1, [row(1)], 2);
    if (failure === "revision") next.revision = "changed";
    if (failure === "actor") next.actor_id = "other";
    if (failure === "duplicate") next.rows = [row(0)];
    if (failure === "empty") next.rows = [];
    api.rpc.mockResolvedValueOnce({ data: next, error: null });
    await expect(getPendingShifts("branch-a")).rejects.toThrow();
  });
  it("does not fall back to the legacy view when access is denied", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(getPendingShifts("branch-a")).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });
});

describe("shift history source", () => {
  function history(rows: Record<string, unknown>[], mode = "blind", total = rows.length, offset = 0, limit = 20) {
    return { ...page(offset, rows, total), kind: "history", mode, limit };
  }
  function blind(index = 0): Record<string, unknown> {
    const data: Record<string, unknown> = row(index);
    delete data.starting_cash; delete data.auto_marked_pending_at;
    return data;
  }
  it("returns cashier history without financial totals and keeps pending status", async () => {
    api.rpc.mockResolvedValue({ data: history([blind()]), error: null });
    const result = await getShiftHistory("branch-a");
    expect(result[0]).toMatchObject({ status: "pending_reconcile", startingCash: null, actualCash: null,
      expectedCash: null, totalSales: null, totalOrders: null, salesByMethod: null, expectedTransfer: null });
    expect(api.from).not.toHaveBeenCalled();
  });
  it.each(["starting_cash", "actual_cash", "expected_cash", "total_sales", "expected_transfer"])(
    "rejects financial field %s in a blind response", async field => {
      api.rpc.mockResolvedValue({ data: history([{ ...blind(), [field]: 999 }]), error: null });
      await expect(getShiftHistory("branch-a")).rejects.toThrow();
    });
  it("rejects another cashier in a blind response", async () => {
    api.rpc.mockResolvedValue({ data: history([{ ...blind(), cashier_id: "other" }]), error: null });
    await expect(getShiftHistory("branch-a")).rejects.toThrow();
  });
  it("retains manager values without substituting zero for missing counts", async () => {
    api.rpc.mockResolvedValue({ data: history([{ ...row(0), expected_cash: 200, actual_cash: null,
      total_sales: 100, total_orders: null }], "reconciliation"), error: null });
    expect((await getShiftHistory("branch-a"))[0]).toMatchObject({ expectedCash: 200, actualCash: null,
      totalSales: 100, totalOrders: null });
  });
  it("fetches only the requested history limit even when the server has more", async () => {
    api.rpc.mockImplementation(async (_name, args) => ({ data: history(Array.from({ length: args.p_limit },
      (_, index) => blind(args.p_offset + index)), "blind", 1201, args.p_offset, args.p_limit), error: null }));
    expect(await getShiftHistory("branch-a", 450)).toHaveLength(450);
    expect(api.rpc.mock.calls.map(([, args]) => args.p_limit)).toEqual([200, 200, 50]);
  });
  it.each([0, -1, 1.5, NaN])("rejects invalid limit %s before requesting data", async limit => {
    await expect(getShiftHistory("branch-a", limit)).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
