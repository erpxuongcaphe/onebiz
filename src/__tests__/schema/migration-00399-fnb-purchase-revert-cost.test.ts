import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00399_fnb_purchase_revert_cost_ledger.sql",
  "utf8",
).toLowerCase();

describe("00399 F&B purchase reversal cost ledger", () => {
  it("records only future received-purchase reversals for opted-in branches", () => {
    expect(migration).toContain("new.reference_type <> 'purchase_order_revert'");
    expect(migration).toContain("new.type <> 'out'");
    expect(migration).toContain("_fnb_branch_cost_tracking_enabled_00390");
    expect(migration).toContain("after insert on public.stock_movements");
    expect(migration).toContain("'purchase_order_revert'");
  });

  it("validates the source purchase, branch, and cumulative reversed quantity", () => {
    expect(migration).toContain("from public.purchase_orders po");
    expect(migration).toContain("v_po_tenant is distinct from new.tenant_id");
    expect(migration).toContain("v_po_branch is distinct from new.branch_id");
    expect(migration).toContain("e.source_type = 'purchase_receipt'");
    expect(migration).toContain("e.source_reference_id = new.reference_id");
    expect(migration).toContain("fnb_purchase_revert_cost_source_required");
    expect(migration).toContain("fnb_purchase_revert_cost_quantity_exceeded");
  });

  it("uses the F&B weighted-average ledger without rewriting business history", () => {
    expect(migration).toContain("_post_fnb_branch_cost_out_00390");
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.(products|purchase_orders|stock_movements)\b/i);
    expect(migration).not.toContain("products.cost_price");
  });
});
