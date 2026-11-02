import { describe, expect, it } from "vitest";
import { parseInventoryMovementV2, type InventoryMovementV2Report, type InventoryMovementV2Row } from "@/lib/reports/inventory-movement-v2-contract";

const tenantId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-000000000002";
const otherBranch = "00000000-0000-4000-8000-000000000003";
const scope = { tenantId, branchId };
function fixture(): InventoryMovementV2Report {
  return {
    version: 2, generated_at: "2026-01-01T00:00:00Z", tenant_id: tenantId, branch_id: branchId,
    cost_visible: false, stock_basis: "branch_stock_net_by_branch_product", age_basis: "not_yet_certified",
    row_count: 1, rows: [{
      branch_id: branchId, product_id: "00000000-0000-4000-8000-000000000004",
      branch_name: "Synthetic branch", code: "TEST", name: "Synthetic item", catalog_unit: "unit",
      unit_status: "current_catalog", product_type: null, inventory_role: null,
      current_qty: "2.5000", reserved_qty: "0.5000", available_qty: "2.0000",
      movement_count: 1, quantity_event_count: 1, zero_audit_count: 0, unsupported_count: 0,
      future_count: 0, ambiguous_order_count: 0, movement_net: "2.5", movement_difference: "0",
      last_receipt_at: "2025-12-31T00:00:00Z", last_stock_out_at: null,
      last_recorded_usage_at: null, last_direct_sale_out_at: null,
      age_status: "unverified", age_buckets: null, age_reason: "coverage_not_certified", review_status: "recent_movement",
    }], summary: { branch_product_count: 1, distinct_products: 1, negative_stock_count: 0,
      history_reconcile_count: 0, unverified_age_count: 1 },
  };
}
function valued(): InventoryMovementV2Report {
  const data = fixture();
  data.cost_visible = true;
  data.rows[0].valuation = { basis: "branch_cost_ledger", source_complete: true,
    status: "supported", value: "10.0000", unit_cost: "4.0000" };
  data.summary.valuation = { ledger_complete: true, ledger_value: "10", known_ledger_subtotal: "10",
    reference_subtotal: "0", incomplete_count: 0, reference_count: 0 };
  return data;
}
describe("inventory movement V2 build-only read contract", () => {
  it("preserves decimal strings without Number coercion or normalization", () => {
    const data = fixture();
    expect(parseInventoryMovementV2(data, scope)).toEqual(data);
    expect(parseInventoryMovementV2(valued(), scope).rows[0].valuation?.value).toBe("10.0000");
  });
  it.each(["NaN", "Infinity", "-Infinity", "1e3", " 2", "2 ", "", "+2", ".2", "2.", "01", "0x10", "9007199254740992", 2, null])("rejects invalid numeric input %s", value => {
    const data = fixture();
    (data.rows[0] as unknown as Record<string, unknown>).current_qty = value;
    expect(() => parseInventoryMovementV2(data, scope)).toThrow();
  });
  it.each([
    (d: InventoryMovementV2Report) => { d.tenant_id = otherBranch; },
    (d: InventoryMovementV2Report) => { d.branch_id = null; },
    (d: InventoryMovementV2Report) => { d.rows[0].branch_id = otherBranch; },
    (d: InventoryMovementV2Report) => { d.rows.push(structuredClone(d.rows[0])); },
    (d: InventoryMovementV2Report) => { d.row_count = 0; },
    (d: InventoryMovementV2Report) => { d.summary.distinct_products = 2; },
    (d: InventoryMovementV2Report) => { d.summary.branch_product_count = 0; },
    (d: InventoryMovementV2Report) => { d.summary.negative_stock_count = 1; },
    (d: InventoryMovementV2Report) => { d.summary.history_reconcile_count = 1; },
    (d: InventoryMovementV2Report) => { d.summary.unverified_age_count = 0; },
    (d: InventoryMovementV2Report) => { d.rows[0].available_qty = "0"; },
    (d: InventoryMovementV2Report) => { d.rows[0].movement_difference = "1"; },
    (d: InventoryMovementV2Report) => { d.rows[0].movement_count = 2; },
    (d: InventoryMovementV2Report) => { d.rows[0].future_count = 2; },
    (d: InventoryMovementV2Report) => { d.rows[0].ambiguous_order_count = 2; },
    (d: InventoryMovementV2Report) => { d.rows[0].age_status = "not_applicable"; },
    (d: InventoryMovementV2Report) => { d.rows[0].age_reason = "no_history"; },
  ])("rejects scope/count/quantity/age inconsistencies %#", mutate => {
    const data = fixture(); mutate(data);
    expect(() => parseInventoryMovementV2(data, scope)).toThrow();
  });
  it("retains negative and reserved-only rows", () => {
    const data = fixture();
    Object.assign(data.rows[0], { current_qty: "-2", reserved_qty: "1", available_qty: "-3",
      movement_net: "-2", age_status: "not_applicable", age_reason: "negative_stock", review_status: "negative_stock" });
    Object.assign(data.summary, { negative_stock_count: 1, unverified_age_count: 0 });
    expect(parseInventoryMovementV2(data, scope).rows[0].current_qty).toBe("-2");
    Object.assign(data.rows[0], { current_qty: "0", available_qty: "-1", movement_net: "0",
      age_reason: "no_stock", review_status: "reserved_without_stock" });
    data.summary.negative_stock_count = 0;
    expect(parseInventoryMovementV2(data, scope).rows).toHaveLength(1);
  });
  it("allows the same product in distinct branches only in all-branch scope", () => {
    const data = fixture(); data.branch_id = null;
    data.rows.push({ ...data.rows[0], branch_id: otherBranch }); data.row_count = 2;
    Object.assign(data.summary, { branch_product_count: 2, unverified_age_count: 2 });
    expect(parseInventoryMovementV2(data, { tenantId, branchId: null }).summary.distinct_products).toBe(1);
  });
  it.each(["valuation", "unit_cost", "stock_value", "cost_price", "value"])("rejects hidden valuation field %s at every level", key => {
    for (const location of ["root", "row", "summary"]) {
      const data = fixture();
      const target = location === "root" ? data : location === "row" ? data.rows[0] : data.summary;
      Object.assign(target, { [key]: key === "valuation" ? valued().rows[0].valuation : "10" });
      expect(() => parseInventoryMovementV2(data, scope)).toThrow();
    }
  });
  it.each([
    (d: InventoryMovementV2Report) => { delete d.rows[0].valuation; },
    (d: InventoryMovementV2Report) => { delete d.summary.valuation; },
    (d: InventoryMovementV2Report) => { d.rows[0].valuation!.value = null; },
    (d: InventoryMovementV2Report) => { d.rows[0].valuation!.unit_cost = null; },
    (d: InventoryMovementV2Report) => { d.rows[0].valuation!.value = "11"; },
    (d: InventoryMovementV2Report) => { d.rows[0].valuation!.basis = "catalog_reference"; },
    (d: InventoryMovementV2Report) => { d.rows[0].valuation!.source_complete = false; },
    (d: InventoryMovementV2Report) => { d.summary.valuation!.known_ledger_subtotal = "9"; },
    (d: InventoryMovementV2Report) => { d.summary.valuation!.reference_subtotal = "1"; },
    (d: InventoryMovementV2Report) => { d.summary.valuation!.ledger_value = null; },
    (d: InventoryMovementV2Report) => { d.summary.valuation!.incomplete_count = 1; },
    (d: InventoryMovementV2Report) => { d.summary.valuation!.reference_count = 1; },
  ])("rejects valuation inconsistencies %#", mutate => {
    const data = valued(); mutate(data);
    expect(() => parseInventoryMovementV2(data, scope)).toThrow();
  });
  it("keeps reference and incomplete amounts separate, never inventing a total", () => {
    const data = valued();
    const second: InventoryMovementV2Row = { ...structuredClone(data.rows[0]), branch_id: otherBranch,
      valuation: { basis: "catalog_reference", status: "reference_only", source_complete: true, value: "10", unit_cost: "4" } };
    const third = structuredClone(second); third.product_id = "00000000-0000-4000-8000-000000000005";
    third.valuation = { basis: "branch_cost_ledger", status: "incomplete", source_complete: false, value: null, unit_cost: null };
    data.branch_id = null; data.rows.push(second, third); data.row_count = 3;
    Object.assign(data.summary, { branch_product_count: 3, distinct_products: 2, unverified_age_count: 3,
      valuation: { ledger_complete: false, ledger_value: null, known_ledger_subtotal: "10", reference_subtotal: "10", incomplete_count: 1, reference_count: 1 } });
    const all = { tenantId, branchId: null };
    expect(parseInventoryMovementV2(data, all).rows[2].valuation?.value).toBeNull();
    data.summary.valuation!.ledger_value = "20";
    expect(() => parseInventoryMovementV2(data, all)).toThrow();
    data.summary.valuation!.ledger_value = null; third.valuation.value = "0";
    expect(() => parseInventoryMovementV2(data, all)).toThrow();
  });
  it("validates exact fractional arithmetic and permits genuine zero valuation", () => {
    const data = valued();
    Object.assign(data.rows[0], { current_qty: "0.3", reserved_qty: "0.1", available_qty: "0.2", movement_net: "0.3" });
    Object.assign(data.rows[0].valuation!, { unit_cost: "0.1", value: "0.03" });
    Object.assign(data.summary.valuation!, { ledger_value: "0.03", known_ledger_subtotal: "0.03" });
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
    Object.assign(data.rows[0].valuation!, { unit_cost: "0", value: "0" });
    Object.assign(data.summary.valuation!, { ledger_value: "0", known_ledger_subtotal: "0" });
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
  });
  it("accepts empty quantity-only and visible-cost reports", () => {
    for (const data of [fixture(), valued()]) {
      data.rows = []; data.row_count = 0;
      Object.assign(data.summary, { branch_product_count: 0, distinct_products: 0, unverified_age_count: 0 });
      if (data.summary.valuation) Object.assign(data.summary.valuation, { ledger_value: "0", known_ledger_subtotal: "0" });
      expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
    }
  });
  it("preserves canonical negative ledger values without deriving them from unit cost", () => {
    const data = valued();
    Object.assign(data.rows[0], { current_qty: "-2.5", available_qty: "-3", movement_net: "-2.5",
      age_status: "not_applicable", age_reason: "negative_stock", review_status: "negative_stock" });
    data.rows[0].valuation!.value = "-10";
    Object.assign(data.summary, { negative_stock_count: 1, unverified_age_count: 0 });
    Object.assign(data.summary.valuation!, { ledger_value: "-10", known_ledger_subtotal: "-10" });
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
  });
  it("allows null unit cost only for zero stock with genuine zero value", () => {
    const data = valued();
    Object.assign(data.rows[0], { current_qty: "0", available_qty: "-0.5", movement_net: "0",
      age_status: "not_applicable", age_reason: "no_stock", review_status: "reserved_without_stock" });
    Object.assign(data.rows[0].valuation!, { value: "0", unit_cost: null });
    data.summary.unverified_age_count = 0;
    Object.assign(data.summary.valuation!, { ledger_value: "0", known_ledger_subtotal: "0" });
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
    data.rows[0].valuation!.value = null;
    expect(() => parseInventoryMovementV2(data, scope)).toThrow();
  });
  it("rejects invented age buckets, unknown fields and oversized row sets", () => {
    const data = fixture();
    Object.assign(data.rows[0], { age_buckets: { days_0_30: "2.5" } });
    expect(() => parseInventoryMovementV2(data, scope)).toThrow();
    const unknown = fixture(); Object.assign(unknown.rows[0], { age_days: 1 });
    expect(() => parseInventoryMovementV2(unknown, scope)).toThrow();
    const oversized = fixture(); oversized.rows = Array(10001).fill(oversized.rows[0]);
    expect(() => parseInventoryMovementV2(oversized, scope)).toThrow();
  });
  it("preserves historical canonical value independently of rounded unit cost", () => {
    const data = valued();
    Object.assign(data.rows[0], { current_qty: "3", available_qty: "2.5", movement_net: "3" });
    data.rows[0].valuation!.unit_cost = "3.3333";
    const result = parseInventoryMovementV2(data, scope);
    expect(result.rows[0].valuation).toMatchObject({ value: "10.0000", unit_cost: "3.3333" });
    expect(result.summary.valuation!.ledger_value).toBe("10");
    data.rows[0].valuation!.basis = "catalog_reference";
    data.rows[0].valuation!.status = "reference_only";
    Object.assign(data.summary.valuation!, { ledger_complete: false, ledger_value: null,
      known_ledger_subtotal: "0", reference_subtotal: "10", reference_count: 1 });
    expect(parseInventoryMovementV2(data, scope).rows[0].valuation!.value).toBe("10.0000");
  });
  it("counts future and ambiguous supported events without adding future quantity to movement net", () => {
    const data = fixture();
    Object.assign(data.rows[0], { movement_count: 5, quantity_event_count: 3, zero_audit_count: 1,
      unsupported_count: 1, future_count: 2, ambiguous_order_count: 2,
      movement_net: "1.5", movement_difference: "1", age_reason: "unsupported_movement",
      review_status: "reconcile_history" });
    data.summary.history_reconcile_count = 1;
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
    Object.assign(data.rows[0], { movement_count: 4, unsupported_count: 0, age_reason: "future_movement" });
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
  });
  it("uses SQL snapshot microseconds for future timestamps and strict 60-day boundary", () => {
    const data = fixture(); data.generated_at = "2026-01-01T00:00:00.000001Z";
    data.rows[0].last_receipt_at = "2025-11-02T00:00:00.000001Z";
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
    data.rows[0].last_receipt_at = "2025-11-02T00:00:00.000000Z";
    data.rows[0].review_status = "review_no_outflow";
    expect(() => parseInventoryMovementV2(data, scope)).not.toThrow();
    data.rows[0].last_receipt_at = "2026-01-01T00:00:00.000002Z";
    data.rows[0].review_status = "recent_movement";
    expect(() => parseInventoryMovementV2(data, scope)).toThrow();
  });
});
