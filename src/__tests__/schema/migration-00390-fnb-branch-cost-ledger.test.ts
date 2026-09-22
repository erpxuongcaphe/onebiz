import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/00390_fnb_branch_cost_ledger.sql"),
  "utf8",
).toLowerCase();

describe("00390 F&B branch cost ledger", () => {
  it("keeps the F&B cost ledger isolated and browser writes blocked", () => {
    expect(migration).toContain("fnb_branch_product_cost_balances");
    expect(migration).toContain("fnb_branch_product_cost_events");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.fnb_branch_product_cost_balances");
    expect(migration).toContain("grant select on public.fnb_branch_product_cost_balances");
    expect(migration).toContain("_post_fnb_branch_cost_in_00390");
    expect(migration).toContain("_capture_fnb_branch_cost_stock_movement_00390()");
  });

  it("requires an audited opening cost instead of guessing historic value", () => {
    expect(migration).toContain("set_fnb_branch_opening_cost_00390");
    expect(migration).toContain("fnb_branch_cost_opening_stock_required");
    expect(migration).toContain("fnb_branch_cost_opening_already_posted");
    expect(migration).toContain("fnb_branch_opening_cost");
    expect(migration).not.toContain("update public.products set cost_price");
  });

  it("uses the branch ledger for F&B BOM costing, never a Retail sell price", () => {
    const resolver = migration.slice(migration.indexOf("calculate_fnb_bom_branch_cost_00390"));

    expect(migration).toContain("calculate_fnb_bom_branch_cost_00390");
    expect(migration).toContain("fnb_branch_weighted_average");
    expect(migration).toContain("fnb_branch_cost_required");
    expect(resolver).not.toContain("p.sell_price");
  });

  it("preserves the catalog-enforcing internal-sale wrapper and tracks future flows only", () => {
    expect(migration).toContain("_create_internal_sale_catalog_impl_00390");
    expect(migration).toContain("_fnb_branch_cost_tracking_enabled_00390");
    expect(migration).toContain("grant execute on function public.create_internal_sale_atomic");
    expect(migration).toContain("purchase_receipt");
    expect(migration).toContain("internal_sale_receipt");
    expect(migration).toContain("production_complete");
    expect(migration).not.toContain("insert into public.stock_movements");
  });
});
