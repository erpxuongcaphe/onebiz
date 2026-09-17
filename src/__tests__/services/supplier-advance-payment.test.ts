import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00383_supplier_advance_payment.sql",
  "utf8",
);
const totalDialog = readFileSync(
  "src/components/shared/dialogs/settle-debt-dialog.tsx",
  "utf8",
);
const documentDialog = readFileSync(
  "src/components/shared/dialogs/record-payment-dialog.tsx",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/payments.ts",
  "utf8",
);

describe("supplier advance payment", () => {
  it("settles the purchase document at zero and stores only the excess as advance", () => {
    expect(migration).toContain("create table if not exists public.supplier_advances");
    expect(migration).toContain("v_applied := least(v_amount, round(v_po.debt, 2))");
    expect(migration).toContain("v_advance := v_amount - v_applied");
    expect(migration).not.toContain("raise exception 'PAYMENT_EXCEEDS_DEBT'");
    expect(migration).toContain("SUPPLIER_ADVANCE_NOTE_REQUIRED");
  });

  it("keeps supplier totals, aging and cancellation aligned with the advance ledger", () => {
    expect(migration).toContain("v_purchase_debt + v_opening - v_advance");
    expect(migration).toContain("create or replace function public.get_payable_aging_report");
    expect(migration).toContain("-a.remaining_amount");
    expect(migration).toContain("SUPPLIER_ADVANCE_ALREADY_APPLIED");
    expect(migration).toContain("v_cash.amount - coalesce(v_advance.original_amount, 0)");
  });

  it("allows only supplier overpayment and explains the split in both dialogs", () => {
    expect(totalDialog).toContain('mode === "customer" && amount > totalDebt');
    expect(totalDialog).toContain("sẽ được ghi nhận là tiền ứng trước NCC");
    expect(documentDialog).toContain("!isInvoice && amount > currentDebt");
    expect(documentDialog).toContain("không làm công nợ phiếu nhập thành số âm");
  });

  it("loads debt documents in the selected branch", () => {
    expect(service).toContain('query = query.eq("branch_id", branchId)');
    expect(totalDialog).toContain("getOpenPurchasesBySupplier(partyId, branchId)");
  });
});
