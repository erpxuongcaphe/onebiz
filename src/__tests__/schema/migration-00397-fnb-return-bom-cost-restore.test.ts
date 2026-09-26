import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00397_fnb_return_bom_cost_restore.sql",
  "utf8",
).toLowerCase();

describe("00397 F&B BOM return cost restore", () => {
  it("tracks only future BOM ingredient returns in opted-in F&B branches", () => {
    expect(migration).toContain("new.reference_type <> 'return_bom_restore'");
    expect(migration).toContain("_fnb_branch_cost_tracking_enabled_00390");
    expect(migration).toContain("after insert on public.stock_movements");
    expect(migration).toContain("when (new.type = 'in' and new.reference_type = 'return_bom_restore')");
    expect(migration).toContain("'return_bom_restore'");
    expect(migration).not.toContain("reference_type = 'sales_return'");
  });

  it("uses the source invoice's recorded issue cost and bounds returned quantity", () => {
    expect(migration).toContain("sr.invoice_id into v_invoice_id");
    expect(migration).toContain("join public.invoices i");
    expect(migration).toContain("i.status = 'completed'");
    expect(migration).toContain("e.source_type = 'bom_consume'");
    expect(migration).toContain("e.source_reference_id = v_invoice_id");
    expect(migration).toContain("prior.reference_type = 'return_bom_restore'");
    expect(migration).toContain("fnb_return_cost_history_required");
    expect(migration).toContain("fnb_return_cost_source_required");
    expect(migration).toContain("fnb_return_cost_quantity_exceeded");
    expect(migration).toContain("round(v_source_total_cost / v_source_quantity, 6)");
  });

  it("does not guess from shared Retail prices or rewrite historical data", () => {
    expect(migration).not.toMatch(/update\s+public\.(products|stock_movements|invoices)\b/i);
    expect(migration).not.toContain("products.cost_price");
    expect(migration).not.toContain("p.sell_price");
    expect(migration).not.toContain("insert into public.stock_movements");
    expect(migration).toContain("_post_fnb_branch_cost_in_00390");
  });
});
