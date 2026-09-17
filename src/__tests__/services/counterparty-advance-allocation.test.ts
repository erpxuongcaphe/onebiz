import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00385_counterparty_advance_allocation.sql",
  ),
  "utf8",
).toLowerCase();

const payments = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/payments.ts"),
  "utf8",
);

const detailDialog = readFileSync(
  join(process.cwd(), "src/components/shared/dialogs/debt-detail-dialog.tsx"),
  "utf8",
);

describe("counterparty advance allocation", () => {
  it("keeps a source-to-document allocation ledger for both counterparties", () => {
    expect(migration).toContain("customer_advances");
    expect(migration).toContain("supplier_advance_allocations");
    expect(migration).toContain("customer_advance_allocations");
    expect(migration).toContain("supplier_advance_id");
    expect(migration).toContain("cash_transaction_id");
  });

  it("applies only same-party, same-branch available balances atomically", () => {
    expect(migration).toContain("function public.apply_supplier_advance_to_purchase_order(");
    expect(migration).toContain("function public.apply_customer_advance_to_invoice(");
    expect(migration).toContain("branch_id = v_po.branch_id");
    expect(migration).toContain("branch_id = v_invoice.branch_id");
    expect(migration).toContain("for update");
    expect(migration).toContain("remaining_amount - v_take");
    expect(migration).toContain("greatest(0");
  });

  it("does not create a second cash transaction and blocks cancellation after use", () => {
    expect(migration).toContain("supplier_advance_applied");
    expect(migration).toContain("customer_advance_applied");
    expect(migration).toContain("advance_already_applied_cannot_cancel");
    expect(migration).toContain("trg_cash_cancel_block_allocated_advance");
  });

  it("offers a deliberate allocation action from the debt-document list", () => {
    expect(payments).toContain("applySupplierAdvanceToPurchaseOrder");
    expect(payments).toContain("applyCustomerAdvanceToInvoice");
    expect(detailDialog).toContain("Dùng tiền ứng");
    expect(detailDialog).toContain("ApplyAdvanceDialog");
    expect(detailDialog).toContain("availableAdvance");
    expect(detailDialog).toContain("Boolean(branchId)");
  });
});
