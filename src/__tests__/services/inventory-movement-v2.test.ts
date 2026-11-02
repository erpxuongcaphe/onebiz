import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryMovementV2Report } from "@/lib/reports/inventory-movement-v2-contract";

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), context: vi.fn(), handleError: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => api,
  getCurrentContext: api.context,
  handleError: (error: { message: string }, context: string) => {
    api.handleError(error, context); throw new Error(`[${context}] ${error.message}`);
  },
}));
import { getInventoryMovementV2Report } from "@/lib/services/supabase/inventory-movement-v2";

const tenantId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-000000000002";
const foreignId = "00000000-0000-4000-8000-000000000003";
function fixture(branch: string | null = branchId): InventoryMovementV2Report {
  return {
    version: 2, generated_at: "2026-01-01T00:00:00Z", tenant_id: tenantId, branch_id: branch,
    cost_visible: false, stock_basis: "branch_stock_net_by_branch_product", age_basis: "not_yet_certified",
    row_count: 1, rows: [{
      branch_id: branchId, product_id: "00000000-0000-4000-8000-000000000004",
      branch_name: "Synthetic branch", code: "TEST", name: "Synthetic item", catalog_unit: "unit",
      unit_status: "current_catalog", product_type: null, inventory_role: null,
      current_qty: "3.0000", reserved_qty: "1", available_qty: "2.0000",
      movement_count: 1, quantity_event_count: 1, zero_audit_count: 0, unsupported_count: 0,
      future_count: 0, ambiguous_order_count: 0, movement_net: "3", movement_difference: "0",
      last_receipt_at: "2025-12-31T00:00:00Z", last_stock_out_at: null,
      last_recorded_usage_at: null, last_direct_sale_out_at: null,
      age_status: "unverified", age_buckets: null, age_reason: "coverage_not_certified", review_status: "recent_movement",
    }], summary: { branch_product_count: 1, distinct_products: 1, negative_stock_count: 0,
      history_reconcile_count: 0, unverified_age_count: 1 },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.context.mockResolvedValue({ tenantId, branchId: foreignId, userId: "synthetic-user" });
  api.rpc.mockResolvedValue({ data: fixture(), error: null });
});

describe("inventory movement V2 scoped read service", () => {
  it("calls only the additive RPC with requested branch, not profile branch", async () => {
    expect(await getInventoryMovementV2Report({ branchId })).toEqual(fixture());
    expect(api.context).toHaveBeenCalledOnce();
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("get_inventory_movement_report_v2", { p_branch_id: branchId });
    expect(api.from).not.toHaveBeenCalled();
  });
  it.each([undefined, null])("sends null for omitted/null company scope %s", async branch => {
    api.rpc.mockResolvedValue({ data: fixture(null), error: null });
    expect((await getInventoryMovementV2Report(branch === undefined ? undefined : { branchId: branch })).branch_id).toBeNull();
    expect(api.rpc).toHaveBeenCalledWith("get_inventory_movement_report_v2", { p_branch_id: null });
  });
  it("preserves cost masking without enrichment or made-up zero amounts", async () => {
    const result = await getInventoryMovementV2Report({ branchId });
    expect(Object.hasOwn(result.rows[0], "valuation")).toBe(false);
    expect(Object.hasOwn(result.summary, "valuation")).toBe(false);
    expect(result.rows[0].current_qty).toBe("3.0000");
    expect(result.rows[0].age_buckets).toBeNull();
    expect(api.from).not.toHaveBeenCalled();
  });
  it("preserves canonical valuation separate from rounded unit cost", async () => {
    const data = fixture(); data.cost_visible = true;
    data.rows[0].valuation = { basis: "branch_cost_ledger", source_complete: true, status: "supported", value: "10", unit_cost: "3.3333" };
    data.summary.valuation = { ledger_complete: true, ledger_value: "10", known_ledger_subtotal: "10", reference_subtotal: "0", reference_count: 0, incomplete_count: 0 };
    api.rpc.mockResolvedValue({ data, error: null });
    expect(await getInventoryMovementV2Report({ branchId })).toEqual(data);
  });
  it.each(["tenant", "branch", "row_scope", "shape", "disclosure", "missing_valuation"])("fails closed for invalid %s payload", async kind => {
    const data = fixture();
    if (kind === "tenant") data.tenant_id = foreignId;
    if (kind === "branch") data.branch_id = null;
    if (kind === "row_scope") data.rows[0].branch_id = foreignId;
    if (kind === "shape") data.row_count = 2;
    if (kind === "disclosure") Object.assign(data.rows[0], { unit_cost: "10" });
    if (kind === "missing_valuation") data.cost_visible = true;
    api.rpc.mockResolvedValue({ data, error: null });
    await expect(getInventoryMovementV2Report({ branchId })).rejects.toThrow();
    expect(api.rpc).toHaveBeenCalledOnce(); expect(api.from).not.toHaveBeenCalled();
  });
  it.each(["permission denied", "function does not exist"])("propagates RPC error without fallback: %s", async message => {
    const error = { message, code: "42501" };
    api.rpc.mockResolvedValue({ data: fixture(), error });
    await expect(getInventoryMovementV2Report({ branchId })).rejects.toThrow(message);
    expect(api.handleError).toHaveBeenCalledWith(error, "getInventoryMovementV2Report");
    expect(api.rpc).toHaveBeenCalledOnce(); expect(api.from).not.toHaveBeenCalled();
  });
  it("does not start context lookup or RPC for an already aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getInventoryMovementV2Report({ branchId, signal: controller.signal })).rejects.toThrow();
    expect(api.context).not.toHaveBeenCalled(); expect(api.rpc).not.toHaveBeenCalled();
  });
  it("rejects abort during context resolution before starting RPC", async () => {
    const controller = new AbortController();
    api.context.mockImplementation(async () => { controller.abort(); return { tenantId }; });
    await expect(getInventoryMovementV2Report({ branchId, signal: controller.signal })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it("passes signal to SDK when supported", async () => {
    const controller = new AbortController();
    const abortSignal = vi.fn().mockResolvedValue({ data: fixture(), error: null });
    api.rpc.mockReturnValue({ abortSignal });
    expect(await getInventoryMovementV2Report({ branchId, signal: controller.signal })).toEqual(fixture());
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });
  it.each([true, false])("rejects late results after abort with SDK signal support=%s", async supported => {
    const controller = new AbortController();
    let complete!: (result: { data: InventoryMovementV2Report; error: null }) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    api.rpc.mockReturnValue(supported ? { abortSignal: () => pending } : pending);
    const request = getInventoryMovementV2Report({ branchId, signal: controller.signal });
    await vi.waitFor(() => expect(api.rpc).toHaveBeenCalledOnce());
    controller.abort(); complete({ data: fixture(), error: null });
    await expect(request).rejects.toThrow(); expect(api.from).not.toHaveBeenCalled();
  });
  it("supports SDK without abortSignal when request is not cancelled", async () => {
    expect(await getInventoryMovementV2Report({ branchId, signal: new AbortController().signal })).toEqual(fixture());
  });
  it("propagates context failure without RPC", async () => {
    api.context.mockRejectedValue(new Error("No authenticated context"));
    await expect(getInventoryMovementV2Report({ branchId })).rejects.toThrow("No authenticated context");
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it.each(["", " ", "all"])("rejects ambiguous branch scope %j without RPC", async branchId => {
    await expect(getInventoryMovementV2Report({ branchId })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
