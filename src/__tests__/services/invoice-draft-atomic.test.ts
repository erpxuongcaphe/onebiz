import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/lib/services/supabase/invoices.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/00271_atomic_draft_invoice_edit_cancel.sql",
  "utf8",
);

describe("draft invoice atomic edit and cancel", () => {
  it("removes direct invoice mutation from active services", () => {
    expect(service).toContain('"cancel_draft_invoice_atomic"');
    expect(service).toContain('"update_draft_invoice_atomic"');
    expect(service).not.toMatch(/cancelInvoice[\s\S]{0,1800}\.from\("invoices"\)[\s\S]{0,160}\.update\(/);
    expect(service).not.toMatch(/updateInvoice[\s\S]{0,1800}\.from\("invoices"\)[\s\S]{0,160}\.update\(/);
    expect(service).not.toContain("export async function setInvoiceAmountTendered");
  });

  it("blocks simple cancellation once stock or cash exists", () => {
    expect(migration).toContain("INVOICE_REQUIRES_COMPLETED_VOID");
    expect(migration).toContain("from public.stock_movements");
    expect(migration).toContain("from public.cash_transactions");
    expect(migration).toContain("for update");
    expect(migration).toContain("orders.cancel");
  });

  it("recalculates total, debt and shipment COD when discount changes", () => {
    expect(migration).toContain("subtotal, 0) - v_discount");
    expect(migration).toContain("debt = greatest(0, v_total - coalesce(paid, 0))");
    expect(migration).toContain("set cod_amount = v_total");
    expect(migration).toContain("INVOICE_DISCOUNT_INVALID");
    expect(migration).toContain("insert into public.audit_log");
  });
});
