import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: mocks.rpc }), handleError: (error: Error) => { throw error; } }));
import { getCostReconciliation, parseCostReconciliationRow } from "@/lib/services/supabase/cost-reconciliation";
import { costReconciliationRows, costReconciliationSummary, costReconciliationSheet, costPendingComponentsSheet } from "@/lib/reports/cost-reconciliation";

export const sourceRow = (id = "line-1") => ({ id, invoice_id: "invoice-1", invoice_code: "HD-TEST-01", issued_at: "2026-10-27T10:00:00Z", branch_id: "branch-a", branch_name: "Chi nhánh A",
  product_id: "product-1", code: "SKU-CA-001", name: "Cà phê sữa", quantity: 2, unit: "Ly", transaction_quantity: null, transaction_unit: null,
  conversion_factor: null, stored_unit_cost: null, candidate_unit_cost: 0, status: "ready", pending_components: [],
  evidence: { mode: "historical_component_match", event_count: 3, has_returns: false, last_attempt_at: null } });
const range = { from: "2026-10-01", to: "2026-10-30" };
const response = (rows: unknown[], total = rows.length, revision = "revision-1") => ({ data: { rows, total, revision, checked_at: "2026-10-30T01:00:00Z" }, error: null });
beforeEach(() => vi.clearAllMocks());

describe("cost reconciliation source contract", () => {
  it("preserves legitimate zero candidate costs and missing stored costs", () => {
    expect(parseCostReconciliationRow(sourceRow())).toMatchObject({ candidateUnitCost: 0, storedUnitCost: null, quantity: 2, unit: "Ly" });
  });
  it.each([
    { candidate_unit_cost: -1 }, { candidate_unit_cost: null }, { status: "waiting", candidate_unit_cost: 5 },
    { status: "unknown" }, { quantity: 0 }, { quantity: "NaN" }, { unit: "" }, { issued_at: "invalid" },
    { conversion_factor: 0 }, { candidate_unit_cost: "" }, { candidate_unit_cost: undefined },
    { status: "waiting", candidate_unit_cost: null, pending_components: [] },
    { pending_components: [{ code: "BTP-TEST", name: "Thành phần", unit: "G", pending_quantity: 1, cost_known: true }] },
    { evidence: { mode: "current_catalog", event_count: 1, has_returns: false, last_attempt_at: null } },
    { evidence: { mode: "historical_component_match", event_count: 0, has_returns: false, last_attempt_at: null } },
    { evidence: { mode: "historical_component_match", event_count: 2, has_returns: true, last_attempt_at: null } },
  ])("rejects invalid or uncertified candidates: %j", change => expect(() => parseCostReconciliationRow({ ...sourceRow(), ...change })).toThrow());
  it("loads every page with a stable revision and named branch/date arguments", async () => {
    const first = Array.from({ length: 250 }, (_, n) => sourceRow(`line-${n}`));
    mocks.rpc.mockResolvedValueOnce(response(first, 251)).mockResolvedValueOnce(response([sourceRow("line-250")], 251));
    expect((await getCostReconciliation(range, "branch-a")).rows).toHaveLength(251);
    expect(mocks.rpc.mock.calls[0]).toEqual(["get_cost_reconciliation_workspace_v1", expect.objectContaining({ p_branch_id: "branch-a", p_offset: 0, p_limit: 250, p_from: "2026-09-30T17:00:00.000Z", p_to: "2026-10-30T17:00:00.000Z" })]);
    expect(mocks.rpc.mock.calls[1][1].p_offset).toBe(250);
  });
  it.each(["revision", "duplicate", "truncated", "branch", "total"])("rejects %s rather than returning partial data", async kind => {
    mocks.rpc.mockResolvedValueOnce(response([sourceRow()], 2));
    mocks.rpc.mockResolvedValueOnce(response(kind === "truncated" ? [] : [{ ...sourceRow(kind === "duplicate" ? "line-1" : "line-2"), branch_id: kind === "branch" ? "branch-b" : "branch-a" }], kind === "total" ? 3 : 2, kind === "revision" ? "changed" : "revision-1"));
    await expect(getCostReconciliation(range, "branch-a")).rejects.toThrow();
  });
  it("distinguishes unavailable RPC and errors from empty results", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    await expect(getCostReconciliation(range)).rejects.toThrow("chưa được phát hành");
    mocks.rpc.mockResolvedValueOnce(response([])); expect((await getCostReconciliation(range)).rows).toEqual([]);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); await expect(getCostReconciliation(range)).rejects.toThrow();
  });
  it("rejects an invoice changing status between pages", async () => {
    mocks.rpc.mockResolvedValueOnce(response([sourceRow()], 2));
    mocks.rpc.mockResolvedValueOnce(response([{ ...sourceRow("line-2"), status: "missing", candidate_unit_cost: null }], 2));
    await expect(getCostReconciliation(range, "branch-a")).rejects.toThrow();
  });
  it("exports pending components only once per invoice, never per sale line", () => {
    const row = parseCostReconciliationRow(sourceRow());
    const pendingComponents = [{ code: "BTP-TEST", name: "Thành phần", unit: "G", pendingQuantity: 125, costKnown: true }];
    const sheet = costPendingComponentsSheet([{ ...row, pendingComponents }, { ...row, id: "line-2", pendingComponents }]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({ pendingQuantity: 125, unit: "G" });
  });
  it("counts distinct bills and filters/sorts every loaded row with units intact", () => {
    const a = parseCostReconciliationRow(sourceRow()), b = { ...a, id: "line-2", code: "SKU-CA-002", quantity: 5 };
    expect(costReconciliationSummary([a, b]).find(x => x.status === "ready")).toMatchObject({ invoices: 1, lines: 2 });
    const rows = costReconciliationRows([a, b], { search: "ca phe sua", status: "ready", product: "product-1", unit: "Ly" }, { id: "quantity", direction: "desc" });
    expect(rows.map(x => x.quantity)).toEqual([5, 2]);
    expect(costReconciliationSheet(rows).rows[0]).toMatchObject({ quantity: 5, candidateUnitCost: 0, unit: "Ly", transactionQuantity: null });
  });
});
