import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => api, getCurrentTenantId: async () => "tenant-a",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getReconciledShifts, previewShiftClose } from "@/lib/services/supabase/shifts";
import { parseShiftPreview } from "@/lib/services/supabase/shift-readers";

const preview = () => ({ shift_id: "shift-a", tenant_id: "tenant-a", branch_id: "branch-a",
  starting_cash: 100, cash_in: 200, cash_out: 50, expected_cash: 250, total_sales: 200,
  total_orders: 1, sales_by_method: { cash: 100, transfer: 100 }, cash_entries_count: 0, cash_entries: [] as unknown[] });
const row = (index: number) => ({ id: `shift-${index}`, tenant_id: "tenant-a", branch_id: "branch-a",
  branch_name: "Demo", cashier_id: "actor-a", cashier_name: "Demo", reconciled_by: null,
  reconciled_by_name: null, opened_at: "2026-10-01T01:00:00Z", closed_at: "2026-10-01T09:00:00Z",
  reconciled_at: null, auto_marked_pending_at: null, starting_cash: 100, expected_cash: 200,
  actual_cash: 200, cash_difference: 0, total_sales: 100, total_orders: 1, note: null,
  reconcile_reason: null, close_kind: null, expected_transfer: null, actual_transfer: null, transfer_difference: null });
const page = (offset = 0, rows = [row(0)], total = rows.length) => ({
  tenant_id: "tenant-a", branch_id: "branch-a", from: null, to_exclusive: null, type: "all",
  offset, limit: 200, total_count: total, revision: "revision-a", rows,
});
beforeEach(() => vi.resetAllMocks());

describe("scoped shift preview", () => {
  it("uses one server summary request without direct table reads", async () => {
    api.rpc.mockResolvedValue({ data: preview(), error: null });
    const result = await previewShiftClose("shift-a");
    expect(result.expectedCash).toBe(250);
    expect(result.totalSales).toBe(200);
    expect(api.rpc).toHaveBeenCalledWith("get_shift_close_preview_scoped", { p_shift_id: "shift-a" });
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.from).not.toHaveBeenCalled();
  });
  it("keeps full totals and count while returning the latest 100 cash entries", () => {
    const data = preview(); data.cash_entries_count = 1201;
    data.cash_entries = Array.from({ length: 100 }, (_, index) => ({ id: `cash-${index}`, code: `PT${index}`,
      type: "receipt", amount: "100", category: "Sale", note: null, created_at: "2026-10-01T01:00:00Z" }));
    const result = parseShiftPreview(data, "shift-a", "tenant-a");
    expect(result.cashEntryCount).toBe(1201);
    expect(result.cashEntries).toHaveLength(100);
    expect(result.totalSales).toBe(200);
  });
  it.each([null, { ...preview(), shift_id: "other" }, { ...preview(), tenant_id: "other" },
    { ...preview(), branch_id: null }, { ...preview(), cash_in: null }, { ...preview(), expected_cash: 999 },
    { ...preview(), total_sales: 999 }, { ...preview(), cash_entries_count: 1 },
    { ...preview(), total_orders: 1.5 }, { ...preview(), sales_by_method: { cash: "NaN" } },
  ])("rejects missing or inconsistent preview data", data => {
    expect(() => parseShiftPreview(data, "shift-a", "tenant-a")).toThrow();
  });
  it("does not fall back when the server denies preview access", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(previewShiftClose("shift-a")).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });
});

describe("scoped reconciliation list", () => {
  it("loads all 1201 rows, retaining unknown transfer reconciliation as null", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => row(index));
    api.rpc.mockImplementation(async (_name, args) => ({ data: page(args.p_offset,
      rows.slice(args.p_offset, args.p_offset + args.p_limit), rows.length), error: null }));
    const result = await getReconciledShifts({ branchId: "branch-a" });
    expect(result).toHaveLength(1201);
    expect(result[0].actualTransfer).toBeNull();
    expect(api.rpc).toHaveBeenCalledTimes(7);
    expect(api.rpc.mock.calls.every(([name]) => name === "get_reconciled_shifts_scoped")).toBe(true);
    expect(api.from).not.toHaveBeenCalled();
  });
  it("passes exact business-day boundaries and type filters to the server", async () => {
    api.rpc.mockImplementation(async (_name, args) => ({ data: { ...page(0, [], 0), type: args.p_type,
      from: args.p_from, to_exclusive: args.p_to_exclusive }, error: null }));
    await getReconciledShifts({ branchId: "branch-a", dateFrom: "2026-10-01", dateTo: "2026-10-01", type: "self" });
    expect(api.rpc).toHaveBeenCalledWith("get_reconciled_shifts_scoped", {
      p_branch_id: "branch-a", p_from: "2026-09-30T17:00:00.000Z", p_to_exclusive: "2026-10-01T17:00:00.000Z",
      p_type: "self", p_offset: 0, p_limit: 200,
    });
  });
  it("lets the server scope the all-branches selection", async () => {
    api.rpc.mockResolvedValue({ data: { ...page(), branch_id: null }, error: null });
    expect(await getReconciledShifts()).toHaveLength(1);
    expect(api.rpc.mock.calls[0][1].p_branch_id).toBeNull();
    expect(api.from).not.toHaveBeenCalled();
  });
  it.each(["revision", "count", "duplicate", "missing", "branch", "tenant"])("rejects inconsistent pages: %s", async failure => {
    api.rpc.mockResolvedValueOnce({ data: page(0, [row(0)], 2), error: null });
    const next = page(1, [row(1)], 2);
    if (failure === "revision") next.revision = "changed";
    if (failure === "count") next.total_count = 3;
    if (failure === "duplicate") next.rows = [row(0)];
    if (failure === "missing") next.rows = [];
    if (failure === "branch") next.rows[0].branch_id = "other";
    if (failure === "tenant") next.tenant_id = "other";
    api.rpc.mockResolvedValueOnce({ data: next, error: null });
    await expect(getReconciledShifts({ branchId: "branch-a" })).rejects.toThrow();
  });
  it("does not convert a denied request into an empty report", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(getReconciledShifts()).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });
});
