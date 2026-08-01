import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/lib/services/supabase/cash-book.ts", "utf8");
const dialog = readFileSync(
  "src/components/shared/dialogs/create-cash-transaction-dialog.tsx",
  "utf8",
);
const excelImport = readFileSync("src/lib/services/supabase/excel-import.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/00267_harden_cash_book_atomic.sql",
  "utf8",
);

describe("cash-book atomic hardening", () => {
  it("creates and cancels vouchers only through audited server functions", () => {
    expect(service).toContain('"create_manual_cash_transaction_atomic"');
    expect(service).toContain('"cancel_cash_transaction"');
    expect(service).not.toMatch(/createCashTransaction[\s\S]{0,1400}\.from\("cash_transactions"\)[\s\S]{0,160}\.insert\(/);
    expect(excelImport).toContain("createManualCashTransactionAtomic({");
    expect(excelImport).toContain("transactionDate: formatDateInputValue(row.date)");
    expect(excelImport).not.toMatch(/bulkImportCashTransactions[\s\S]{0,2200}\.from\("cash_transactions"\)[\s\S]{0,160}\.insert\(/);
    expect(service).not.toMatch(/cancelCashTransaction[\s\S]{0,1400}\.from\("cash_transactions"\)[\s\S]{0,160}\.update\(/);
  });

  it("requires permissions, tenant branch access, reason and row locking", () => {
    expect(migration).toContain("finance.create_transaction");
    expect(migration).toContain("finance.void_transaction");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("for update");
    expect(migration).toContain("CASH_CANCEL_REASON_REQUIRED");
    expect(migration).toContain("insert into public.audit_log");
  });

  it("does not allow unallocated debt payments", () => {
    expect(dialog).toContain('newErrors.reference = "Cần chọn chứng từ còn nợ"');
    expect(dialog).toContain("errors.reference");
    expect(migration).toContain("DEBT_PAYMENT_REQUIRES_DOCUMENT");
  });
});
