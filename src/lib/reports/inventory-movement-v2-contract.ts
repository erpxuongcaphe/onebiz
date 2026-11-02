import { z } from "zod";
import Decimal from "decimal.js-light";

// Local precision avoids changing arithmetic settings used by other reports.
const D = Decimal.clone({ precision: 256 });
const decimal = z.string().max(100).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value => {
  const number = new D(value);
  return number.abs().lte(Number.MAX_SAFE_INTEGER) &&
    (number.isZero() || Number(value) !== 0);
}, "Decimal exceeds safe display range");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const timestampMicros = (value: string) => {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3, 6));
};
const valuation = z.strictObject({
  basis: z.enum(["branch_cost_ledger", "catalog_reference"]),
  source_complete: z.boolean(),
  status: z.enum(["supported", "reference_only", "incomplete"]),
  value: decimal.nullable(), unit_cost: decimal.nullable(),
});
const row = z.strictObject({
  branch_id: id, product_id: id, branch_name: z.string(), code: z.string(), name: z.string(),
  catalog_unit: z.string().nullable(), unit_status: z.enum(["missing", "current_catalog"]),
  product_type: z.string().nullable(), inventory_role: z.string().nullable(),
  current_qty: decimal, reserved_qty: decimal, available_qty: decimal,
  movement_count: count, movement_net: decimal, movement_difference: decimal,
  quantity_event_count: count, zero_audit_count: count, unsupported_count: count,
  future_count: count, ambiguous_order_count: count,
  last_receipt_at: timestamp.nullable(), last_stock_out_at: timestamp.nullable(),
  last_recorded_usage_at: timestamp.nullable(), last_direct_sale_out_at: timestamp.nullable(),
  age_status: z.enum(["unverified", "not_applicable"]), age_buckets: z.null(),
  age_reason: z.enum(["no_stock", "negative_stock", "unsupported_movement", "future_movement",
    "no_history", "balance_mismatch", "ambiguous_order", "coverage_not_certified"]),
  review_status: z.enum(["negative_stock", "invalid_reservation", "reserved_without_stock",
    "reconcile_history", "review_no_outflow", "insufficient_history", "recent_movement"]),
  valuation: valuation.optional(),
});
const summaryValuation = z.strictObject({
  ledger_complete: z.boolean(), ledger_value: decimal.nullable(),
  known_ledger_subtotal: decimal, reference_subtotal: decimal,
  incomplete_count: count, reference_count: count,
});
const schema = z.strictObject({
  version: z.literal(2), generated_at: timestamp, tenant_id: id, branch_id: id.nullable(),
  cost_visible: z.boolean(), stock_basis: z.literal("branch_stock_net_by_branch_product"),
  age_basis: z.literal("not_yet_certified"), row_count: count,
  rows: z.array(row).max(10000),
  summary: z.strictObject({
    branch_product_count: count, distinct_products: count, negative_stock_count: count,
    history_reconcile_count: count, unverified_age_count: count,
    valuation: summaryValuation.optional(),
  }),
});

export type InventoryMovementV2Report = z.infer<typeof schema>;
export type InventoryMovementV2Row = z.infer<typeof row>;

/** Build-only read contract. Never supplies prices or defaults for inventory writes. */
export function parseInventoryMovementV2(
  input: unknown, scope: { tenantId: string; branchId: string | null },
): InventoryMovementV2Report {
  const data = schema.parse(input);
  const check = (valid: boolean, message: string) => {
    if (!valid) throw new Error(`Invalid inventory V2 payload: ${message}`);
  };
  const equal = (a: string | null, b: Decimal) => a !== null && new D(a).eq(b);
  check(data.tenant_id === scope.tenantId && data.branch_id === scope.branchId, "scope mismatch");
  check(data.row_count === data.rows.length, "row count mismatch");
  const pairs = new Set<string>();
  let ledger = new D(0), reference = new D(0), incomplete = 0, references = 0;
  for (const r of data.rows) {
    const key = `${r.branch_id}:${r.product_id}`;
    check(!pairs.has(key) && (scope.branchId === null || r.branch_id === scope.branchId), "row scope or duplicate pair");
    pairs.add(key);
    const qty = new D(r.current_qty), reserved = new D(r.reserved_qty);
    check(!qty.isZero() || !reserved.isZero(), "empty stock row");
    check(equal(r.available_qty, qty.minus(reserved)) &&
      equal(r.movement_difference, qty.minus(r.movement_net)), "quantity arithmetic");
    check(new D(r.quantity_event_count).plus(r.zero_audit_count).plus(r.unsupported_count).eq(r.movement_count) &&
      r.future_count <= r.quantity_event_count && r.ambiguous_order_count <= r.quantity_event_count, "movement counts");
    check(r.unit_status === (r.catalog_unit?.replace(/^ +| +$/g, "") ? "current_catalog" : "missing"), "unit status");
    const reason = qty.isZero() ? "no_stock" : qty.lt(0) ? "negative_stock" :
      r.unsupported_count > 0 ? "unsupported_movement" : r.future_count > 0 ? "future_movement" :
        r.quantity_event_count === 0 ? "no_history" : !new D(r.movement_difference).isZero() ? "balance_mismatch" :
          r.ambiguous_order_count > 0 ? "ambiguous_order" : "coverage_not_certified";
    check(r.age_status === (qty.gt(0) ? "unverified" : "not_applicable") && r.age_reason === reason, "uncertified age");
    const lastOut = r.last_stock_out_at ?? r.last_receipt_at;
    const review = qty.lt(0) ? "negative_stock" : reserved.lt(0) ? "invalid_reservation" :
      qty.isZero() && reserved.gt(0) ? "reserved_without_stock" :
        r.unsupported_count > 0 || r.future_count > 0 || !new D(r.movement_difference).isZero() ? "reconcile_history" :
          lastOut && timestampMicros(lastOut) < timestampMicros(data.generated_at) - BigInt(60) * BigInt(86400000000) ? "review_no_outflow" :
            !lastOut ? "insufficient_history" : "recent_movement";
    check(r.review_status === review, "review status");
    for (const time of [r.last_receipt_at, r.last_stock_out_at, r.last_recorded_usage_at, r.last_direct_sale_out_at]) {
      check(time === null || timestampMicros(time) <= timestampMicros(data.generated_at), "future activity timestamp");
    }
    check(data.cost_visible ? r.valuation !== undefined : !Object.hasOwn(r, "valuation"), "valuation visibility");
    const v = r.valuation;
    if (!v) continue;
    if (v.status === "incomplete") {
      check(!v.source_complete && v.value === null && v.unit_cost === null, "incomplete valuation");
      incomplete++;
    } else {
      check(v.source_complete && v.value !== null &&
        v.status === (v.basis === "branch_cost_ledger" ? "supported" : "reference_only"), "valuation basis");
      check(v.unit_cost !== null || qty.isZero(), "missing unit cost");
      // SQL certifies quantity provenance before emitting source_complete. The payload
      // omits source quantity; a rounded unit cost cannot recertify historical value.
      // No precision/tolerance guarantee exists, so sum canonical values unchanged.
      if (v.status === "supported") ledger = ledger.plus(v.value!);
      else { reference = reference.plus(v.value!); references++; }
    }
  }
  const s = data.summary;
  check(s.branch_product_count === data.rows.length &&
    s.distinct_products === new Set(data.rows.map(r => r.product_id)).size &&
    s.negative_stock_count === data.rows.filter(r => new D(r.current_qty).lt(0)).length &&
    s.history_reconcile_count === data.rows.filter(r => r.review_status === "reconcile_history").length &&
    s.unverified_age_count === data.rows.filter(r => r.age_status === "unverified").length, "summary counts");
  check(data.cost_visible ? s.valuation !== undefined : !Object.hasOwn(s, "valuation"), "summary valuation visibility");
  if (s.valuation) {
    const v = s.valuation, complete = incomplete === 0 && references === 0;
    check(v.incomplete_count === incomplete && v.reference_count === references &&
      v.ledger_complete === complete && equal(v.known_ledger_subtotal, ledger) &&
      equal(v.reference_subtotal, reference) &&
      (complete ? equal(v.ledger_value, ledger) : v.ledger_value === null), "summary valuation arithmetic");
  }
  return data;
}
