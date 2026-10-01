import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00412_fnb_invoice_line_branch_bom_cost.sql",
  "utf8",
).replace(/\r\n/g, "\n");

describe("F&B invoice line cost from branch BOM events", () => {
  it("requires the branch ledger and the immutable BOM checkout shape", () => {
    expect(migration).toContain("create or replace function public._snapshot_fnb_invoice_line_cost_00412");
    expect(migration).toContain("if position('_snapshot_fnb_invoice_line_cost_00412' in v_definition) > 0 then");
    expect(migration).toContain("fnb_branch_product_cost_events");
    expect(migration).toContain("fnb_invoice_item_bom_snapshots_00410");
    expect(migration).toContain("_capture_fnb_invoice_item_bom_snapshot_00410");
    expect(migration).toContain("FNB_00412_PAYMENT_LOOP_CHANGED");
  });

  it("attributes each menu line only the branch events created by that line", () => {
    expect(migration).toContain("v_fnb_event_count_before bigint;");
    expect(migration).toContain("v_fnb_cost_before numeric;");
    expect(migration).toContain("v_events_after > p_events_before");
    expect(migration).toContain("v_cost_after - p_cost_before");
    expect(migration).toContain("v_line.inventory_role is distinct from 'fnb_menu_item'");
    expect(migration).toContain("else null end");
  });

  it("does not backfill invoices or touch Retail inventory and prices", () => {
    expect(migration).toContain("where id = p_invoice_item_id;");
    expect(migration).not.toMatch(/\b(update|delete|insert)\s+public\.(products|branch_stock|stock_movements|invoices)\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\.invoice_items\b[\s\S]*?where\s+invoice_id\s*=/i);
    expect(migration).toContain("revoke all on function public._snapshot_fnb_invoice_line_cost_00412");
  });
});
