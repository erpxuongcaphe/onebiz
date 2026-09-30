import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/00410_fnb_invoice_item_bom_return_snapshot.sql",
  "utf8",
);

describe("F&B return uses the source invoice-line BOM snapshot", () => {
  it("adds future-only snapshots without backfilling business history", () => {
    expect(sql).toContain("fnb_invoice_item_bom_snapshots_00410");
    expect(sql).toContain("fnb_invoice_item_bom_snapshot_components_00410");
    expect(sql).toContain("on delete restrict");
    expect(sql).not.toMatch(/update\s+public\.(invoices|invoice_items|return_items|stock_movements)/i);
  });

  it("captures exact consumption on the invoice item and guards the reviewed RPC shape", () => {
    expect(sql).toContain("returning id into v_invoice_item_id");
    expect(sql).toContain("_capture_fnb_invoice_item_bom_snapshot_00410");
    expect(sql).toContain("FNB_00410_PAYMENT_CONSUME_CALL_COUNT_CHANGED");
    expect(sql).toContain("FNB_00410_PAYMENT_INVOICE_ITEM_SHAPE_CHANGED");
    expect(sql).toContain("v_invoice_item_insert_pattern");
    expect(sql).toContain("regexp_matches(v_payment_definition, v_invoice_item_insert_pattern, 'g')");
    expect(sql).toContain("E'\\\\1 returning id into v_invoice_item_id;'");
    expect(sql).not.toContain("v_old_invoice_item_insert");
    expect(sql).toContain("v_invoice.source is distinct from 'fnb'");
    expect(sql).toContain("v_return.invoice_source is distinct from 'fnb'");
  });

  it("restores cumulative rounded quantities from the sold line, not the active BOM", () => {
    expect(sql).toContain("v_component.source_quantity * (v_prior_return_qty + p_quantity) / v_sale.quantity");
    expect(sql).toContain("v_component.source_quantity * v_prior_return_qty / v_sale.quantity");
    expect(sql).toContain("_restore_fnb_invoice_item_bom_00410");
    expect(sql).toContain("FNB_RETURN_BOM_QUANTITY_EXCEEDED");
    expect(sql).toContain("FNB_00410_RETURN_RESTORE_SHAPE_CHANGED");
  });

  it("keeps a visible legacy fallback and never rewrites old return rows", () => {
    expect(sql).toContain("snapshot_mode', 'legacy_active_bom'");
    expect(sql).toContain("FNB_RETURN_LEGACY_BOM_FALLBACK");
    expect(sql).toContain("Existing invoices and return documents are intentionally untouched");
    expect(sql).not.toMatch(/delete\s+from\s+public\.(invoices|invoice_items|return_items|stock_movements)/i);
  });
});

