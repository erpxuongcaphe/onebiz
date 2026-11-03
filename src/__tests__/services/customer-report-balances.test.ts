import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ rpc: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: api.rpc }),
  getCurrentTenantId: api.tenant,
  handleError: (error: Error) => { throw error; },
}));
import { getCustomerReportBalances, parseCustomerReportBalances } from "@/lib/services/supabase/customer-report-balances";

const expected = { tenantId: "tenant-test", branchId: "branch-test" };
function payload() {
  return {
    version: 1, tenant_id: expected.tenantId, branch_id: expected.branchId,
    scope: "branch", branch_ids: [expected.branchId], as_of: "2026-11-03T00:00:00Z",
    revision: "a".repeat(32), basis: "current_receivable_and_customer_advance", can_view_debt: true,
    rows: [{ customer_id: "customer-test", code: "TEST-001", name: "Synthetic customer", receivable: 160, advance: 55 }],
    total_receivable: 160, total_advance: 55, previous_receivable: null,
    unassigned_balance_records: null, unresolved_balance_records: 0, complete: true,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.tenant.mockResolvedValue(expected.tenantId);
  api.rpc.mockResolvedValue({ data: payload(), error: null });
});

describe("staged customer report balances", () => {
  it("keeps receivable and advance separate and does not invent a previous balance", () => {
    const result = parseCustomerReportBalances(payload(), expected);
    expect(result.totalReceivable).toBe(160);
    expect(result.totalAdvance).toBe(55);
    expect(result.previousReceivable).toBeNull();
    expect(result.rows[0]).toEqual({ customerId: "customer-test", code: "TEST-001", name: "Synthetic customer", receivable: 160, advance: 55 });
  });

  it("preserves nulls for masked data", () => {
    const masked = { ...payload(), can_view_debt: false, rows: [], total_receivable: null, total_advance: null,
      unresolved_balance_records: null, complete: null };
    expect(parseCustomerReportBalances(masked, expected)).toMatchObject({
      canViewDebt: false, rows: [], totalReceivable: null, totalAdvance: null, complete: null,
    });
    expect(() => parseCustomerReportBalances({ ...masked, total_receivable: 0 }, expected)).toThrow();
    expect(() => parseCustomerReportBalances({ ...masked, rows: payload().rows }, expected)).toThrow();
  });

  it.each([
    ["tenant_id", "foreign"], ["branch_id", "other-branch"], ["scope", "company"],
    ["branch_ids", ["other-branch"]], ["branch_ids", [expected.branchId, expected.branchId]],
    ["version", 2], ["basis", "lifetime_cached_debt"], ["revision", "missing"],
    ["as_of", "bad-date"], ["can_view_debt", "true"], ["previous_receivable", 160],
    ["total_receivable", 161], ["total_advance", 56], ["total_receivable", -1],
    ["total_receivable", Number.NaN], ["unassigned_balance_records", 1],
    ["unresolved_balance_records", -1], ["unresolved_balance_records", 0.5], ["complete", false],
  ])("rejects inconsistent %s", (key, value) => {
    expect(() => parseCustomerReportBalances({ ...payload(), [key as string]: value }, expected)).toThrow("REPORT_CUSTOMER_BALANCES_INVALID");
  });

  it("rejects duplicate customer identities", () => {
    const p = payload();
    expect(() => parseCustomerReportBalances({ ...p, rows: [...p.rows, ...p.rows], total_receivable: 320, total_advance: 110 }, expected)).toThrow();
  });

  it("keeps incomplete scope visible without claiming a full total", () => {
    const company = { ...payload(), branch_id: null, scope: "company", unassigned_balance_records: 2, complete: false };
    expect(parseCustomerReportBalances(company, { ...expected, branchId: null })).toMatchObject({
      complete: false, unassignedBalanceRecords: 2, totalReceivable: 160,
    });
    expect(parseCustomerReportBalances({ ...payload(), unresolved_balance_records: 1, complete: false }, expected).complete).toBe(false);
  });

  it("uses one RPC with explicit branch and export intent, without direct-table fallback", async () => {
    await getCustomerReportBalances({ branchId: expected.branchId, forExport: true });
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("get_customer_report_balances_v1", { p_branch_id: expected.branchId, p_for_export: true });
  });

  it("defaults to read mode rather than export", async () => {
    await getCustomerReportBalances({ branchId: expected.branchId });
    expect(api.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_for_export: false }));
  });

  it("propagates denial and missing source rather than returning zero", async () => {
    api.rpc.mockResolvedValue({ data: null, error: new Error("REPORT_PERMISSION_DENIED") });
    await expect(getCustomerReportBalances({ branchId: expected.branchId })).rejects.toThrow("REPORT_PERMISSION_DENIED");
    api.rpc.mockResolvedValue({ data: null, error: new Error("RPC unavailable") });
    await expect(getCustomerReportBalances({ branchId: expected.branchId })).rejects.toThrow("RPC unavailable");
  });

  it("rejects invalid requests before making a network call", async () => {
    await expect(getCustomerReportBalances({ branchId: " " })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
