import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00400_fnb_inventory_adjustment_transfer_cost.sql",
  "utf8",
).toLowerCase();

describe("00400 F&B inventory and transfer cost ledger", () => {
  it("values inventory losses at branch WAC and gains only with a branch cost basis", () => {
    expect(migration).toContain("when 'inventory_check' then 'inventory_adjustment'");
    expect(migration).toContain("elsif new.reference_type in ('stock_adjustment', 'initial_stock_reset') then");
    expect(migration).toContain('v_source_tenant := new.tenant_id;');
    expect(migration).toContain('v_source_found := true;');
    expect(migration).toContain("_post_fnb_branch_cost_out_00390");
    expect(migration).toContain("_post_fnb_branch_cost_in_00390");
    expect(migration).toContain("fnb_manual_stock_gain_cost_required");
    expect(migration).toContain("fnb_stock_export_restore_source_required");
    expect(migration).toContain("'supplier_return', 'disposal_export', 'internal_export'");
    expect(migration).not.toContain("products.cost_price");
  });

  it("carries the source branch WAC on transfers and blocks uncosted sources", () => {
    expect(migration).toContain("_complete_stock_transfer_cost_impl_00400");
    expect(migration).toContain("fnb_transfer_source_cost_required");
    expect(migration).toContain("fnb_transfer_cost_movements_required");
    expect(migration).toContain("v_transfer_unit_cost := round(v_cost_total / v_cost_qty, 6)");
    expect(migration).toContain("revoke all on function public._complete_stock_transfer_cost_impl_00400");
  });

  it("adds only event types required for future F&B movements", () => {
    expect(migration).toContain("'inventory_adjustment', 'stock_transfer', 'supplier_return'");
    expect(migration).toContain("'disposal_export_restore', 'internal_export_restore'");
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.(products|stock_movements|invoices)\b/i);
  });
});
