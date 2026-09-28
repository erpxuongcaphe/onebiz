import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00403_isolate_fnb_purchase_global_cost.sql",
  "utf8",
).toLowerCase();

describe("00403 F&B purchase cost isolation", () => {
  it("keeps purchase WAC branch-scoped only for opted-in F&B branches", () => {
    expect(migration).toContain("p_reason = 'purchase_receive'");
    expect(migration).toContain("p_reference_type = 'purchase_order'");
    expect(migration).toContain("_fnb_branch_cost_tracking_enabled_00390");
    expect(migration).toContain("'reason', 'fnb_branch_cost_ledger'");
    expect(migration).toContain("'updated', false");
  });

  it("preserves the existing Retail WAC implementation", () => {
    expect(migration).toContain("if v_old_stock <= 0 or v_old_cost <= 0 then");
    expect(migration).toContain("set cost_price = v_new_cost");
    expect(migration).toContain("'cost_price_update'");
  });

  it("reverts F&B receipts without recalculating shared product cost", () => {
    expect(migration).toContain("_revert_received_po_global_wac_impl_00403");
    expect(migration).toContain("set unit_price = 0");
    expect(migration).toContain("set unit_price = price.value::numeric");
    expect(migration).toContain("'global_cost_preserved', true");
    expect(migration).toContain("revoke all on function public._revert_received_po_global_wac_impl_00403");
  });
});
