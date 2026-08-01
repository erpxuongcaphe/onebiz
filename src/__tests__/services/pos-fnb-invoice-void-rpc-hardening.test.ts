import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00250_harden_fnb_payment_invoice_void.sql",
  ),
  "utf8",
).toLowerCase();
const fnbService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/fnb-checkout.ts"),
  "utf8",
);
const invoiceService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/invoices.ts"),
  "utf8",
);

describe("migration 00250 POS F&B payment and invoice-void hardening", () => {
  it("makes legacy high-privilege functions private or uncallable", () => {
    expect(migration).toContain("rename to _fnb_complete_payment_impl_00230");
    expect(migration).toContain("rename to _void_completed_invoice_impl_00161");
    expect(migration).toContain(
      "revoke all on function public._fnb_complete_payment_impl_00230",
    );
    expect(migration).toContain(
      "revoke all on function public._void_completed_invoice_impl_00161",
    );
    expect(migration).toContain(
      "fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid)",
    );
  });

  it("derives actor and checks effective permission and branch access", () => {
    expect(migration.match(/auth.uid()/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("pos_fnb.view_orders");
    expect(migration).toContain("pos_fnb.discount");
    expect(migration).toContain("pos_fnb.void_paid_bill");
    expect(migration).toContain("pos_retail.void");
    expect(migration.match(/user_has_branch_access/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("validates customer and shift ownership before F&B payment", () => {
    expect(migration).toContain("from public.customers c");
    expect(migration).toContain("c.tenant_id = v_tenant_id");
    expect(migration).toContain("s.cashier_id = v_actor");
    expect(migration).toContain("kitchen_order_already_paid");
    expect(fnbService).toContain("p_created_by: null");
  });

  it("keeps refund method and audit inside the invoice-void transaction", () => {
    expect(migration).toContain("void_completed_invoice_atomic_v2");
    expect(migration).toContain("set payment_method = p_refund_method");
    expect(migration.match(/insert into public.audit_log/g)?.length).toBeGreaterThanOrEqual(2);
    expect(invoiceService).toContain('"void_completed_invoice_atomic_v2"');
    expect(invoiceService).toContain("p_refund_method: params.refundMethod ?? null");
    expect(invoiceService).not.toContain("voidCompletedInvoice: cập nhật phương thức hoàn thất bại");
  });
});
