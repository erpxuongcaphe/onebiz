import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/00244_atomic_sales_return.sql"),
  "utf8",
).toLowerCase();


const returnDialog = readFileSync(
  join(
    process.cwd(),
    "src/components/shared/dialogs/create-return-dialog.tsx",
  ),
  "utf8",
);

describe("migration 00244 atomic sales return", () => {
  it("derives actor, tenant and branch access on the server", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("i.tenant_id = v_tenant_id");
    expect(sql).toContain("user_has_branch_access");
    expect(sql).toContain("user_has_permission");
  });

  it("locks source rows and prevents duplicate or excessive returns", () => {
    expect(sql.match(/for update/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("duplicate_return_item");
    expect(sql).toContain("return_quantity_exceeded");
    expect(sql).toContain("return_quantity_race_detected");
  });

  it("keeps document, stock, refund, debt and audit in one transaction", () => {
    expect(sql).toContain("begin;");
    expect(sql).toContain("insert into public.sales_returns");
    expect(sql).toContain("insert into public.return_items");
    expect(sql).toContain("insert into public.stock_movements");
    expect(sql).toContain("insert into public.cash_transactions");
    expect(sql).toContain("update public.invoices");
    expect(sql).toContain("insert into public.audit_log");
    expect(sql).toContain("commit;");
  });

  it("supports variant-aware BOM restoration for current and older invoices", () => {
    expect(sql).toContain("add column if not exists variant_id");
    expect(sql).toContain("sync_fnb_invoice_item_variants");
    expect(sql).toContain("from public.kitchen_orders ko");
    expect(sql).toContain("v_variant_id");
    expect(sql).toContain("restore_bom_for_return");
  });

  it("blocks direct browser calls to legacy return helpers", () => {
    expect(sql).toContain(
      "revoke all on function public.increment_returned_qty(uuid, numeric)",
    );
    expect(sql).toContain(
      "revoke all on function public.restore_bom_for_return",
    );
    expect(sql).toContain("from public, anon, authenticated");
  });

  it("keeps the browser free of partial return writes", () => {
    expect(returnDialog).toContain("createSalesReturnAtomic");
    expect(returnDialog).not.toContain('.from("sales_returns").insert');
    expect(returnDialog).not.toContain('.from("return_items").insert');
    expect(returnDialog).not.toContain("completeReturn(");
  });
});
