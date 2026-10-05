import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/00423_fnb_invoice_kitchen_line_source.sql");
const basePayment = read("supabase/migrations/00230_fix_fnb_double_pay_guard.sql");

describe("00423 exact F&B kitchen line source", () => {
  it("captures the source ID from the existing payment loop, not a product match", () => {
    const anchor = "select product_id, variant_id, product_name, variant_label, quantity, unit_price, toppings,";
    expect(basePayment.split(anchor)).toHaveLength(2);
    expect(migration).toContain("select id as kitchen_order_item_id, product_id,");
    expect(migration).toContain("_capture_fnb_kitchen_line_source_00423(v_invoice_item_id, r.kitchen_order_item_id)");
    expect(migration).toContain("if v_count <> 1 then");
    expect(migration).toContain("FNB_00423_PAYMENT_INSERT_SHAPE_CHANGED");
  });

  it("keeps the capture private and constrained to its tenant, branch and invoice", () => {
    expect(migration).toContain("i.source = 'fnb'");
    expect(migration).toContain("i.tenant_id = ko.tenant_id and i.branch_id = ko.branch_id");
    expect(migration).toContain("ko.invoice_id is null or ko.invoice_id = i.id");
    expect(migration).toContain("ii.product_id = ki.product_id and ii.quantity = ki.quantity");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toContain("grant execute");
  });

  it("preserves identity and does not backfill or change financial data", () => {
    expect(migration).toContain("invoice_item_id uuid primary key");
    expect(migration).toContain("kitchen_order_item_id uuid not null unique");
    expect(migration).toContain("on delete restrict");
    expect(migration).toContain("FNB_KITCHEN_LINE_SOURCE_CONFLICT");
    for (const table of ["invoices", "invoice_items", "stock_movements", "branch_stock", "cash_transactions", "return_items"]) {
      expect(migration.toLowerCase()).not.toContain(`update public.${table}`);
      expect(migration.toLowerCase()).not.toContain(`insert into public.${table} (`);
      expect(migration.toLowerCase()).not.toContain(`delete from public.${table}`);
    }
  });
});
