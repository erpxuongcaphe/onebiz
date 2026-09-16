import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00381_allow_customer_credit_on_sales_return.sql",
  ),
  "utf8",
).toLowerCase();

const returnDialog = readFileSync(
  join(
    process.cwd(),
    "src/components/shared/dialogs/create-return-dialog.tsx",
  ),
  "utf8",
);

const returnService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/returns-completion.ts"),
  "utf8",
);

describe("retail sales-return customer credit", () => {
  it("settles no more than the invoice debt and records the remainder as customer credit", () => {
    expect(migration).not.toContain("raise exception 'debt_credit_exceeds_invoice_debt'");
    expect(migration).toContain("v_invoice_debt_reduction := least");
    expect(migration).toContain("v_customer_credit := v_debt_credit - v_invoice_debt_reduction");
    expect(migration).toContain("insert into public.customer_debt_adjustments");
    expect(migration).toContain("-v_customer_credit");
    expect(migration).toContain("sales-return-credit:");
  });

  it("keeps cash, quantity, customer and race protections intact", () => {
    expect(migration).toContain("refund_exceeds_return_total");
    expect(migration).toContain("return_quantity_exceeded");
    expect(migration).toContain("customer_required_for_credit_balance");
    expect(migration).toContain("invoice_debt_race_detected");
    expect(migration).toContain("for update");
  });

  it("explains customer credit in the UI instead of blocking a named customer", () => {
    expect(returnDialog).toContain("Ghi có khách");
    expect(returnDialog).toContain("Phần vượt được ghi có vào số dư khách hàng");
    expect(returnDialog).toContain("!selectedInvoice.customer_id");
    expect(returnDialog).not.toContain("Phần cần trừ công nợ vượt quá số nợ còn lại của hóa đơn");
  });

  it("returns the split amounts to the browser for a precise confirmation", () => {
    expect(returnService).toContain("invoiceDebtReduction");
    expect(returnService).toContain("customerCredit");
  });
});
