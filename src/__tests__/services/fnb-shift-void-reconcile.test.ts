import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00402_fix_fnb_void_shift_reconciliation.sql",
  ),
  "utf8",
).toLowerCase();

const shiftService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/shifts.ts"),
  "utf8",
).toLowerCase();

describe("F&B invoice void shift reconciliation", () => {
  it("inherits the original shift only for a reconcilable F&B invoice", () => {
    expect(migration).toContain(
      "function public._void_completed_invoice_atomic_v2_impl_00250",
    );
    expect(migration).toContain("i.customer_name, i.shift_id");
    expect(migration).toContain("elsif coalesce(v_invoice.source, '') = 'fnb'");
    expect(migration).toContain("s.status in ('open', 'pending_reconcile')");
    expect(migration).toContain("'shift_id', v_effective_shift_id");
  });

  it("preserves the public KDS-closing wrapper", () => {
    expect(migration).not.toContain(
      "create or replace function public.void_completed_invoice_atomic_v2(",
    );
    expect(migration).toContain("fnb_kitchen_orders_cancelled");
    expect(migration).toContain("void_wrapper_def");
  });

  it("nets F&B invoice void refunds in preview and atomic close", () => {
    expect(shiftService).toContain('r.reference_type === "invoice_void"');
    expect(shiftService).toContain("fnbvoidinvoiceids.has(r.reference_id)");
    expect(migration).toContain("voided_invoice.source = 'fnb'");
  });

  it("preserves the non-retryable shift conflict sqlstate", () => {
    expect(migration).toContain("errcode = 'pt409'");
    expect(migration).not.toContain("errcode = '40001'");
  });
});
