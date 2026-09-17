import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00384_counterparty_advance_balances.sql",
  ),
  "utf8",
).toLowerCase();

const workspace = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/debt-workspace.ts"),
  "utf8",
);

const debtPage = readFileSync(
  join(process.cwd(), "src/app/(main)/tai-chinh/cong-no/page.tsx"),
  "utf8",
);

const advanceDialog = readFileSync(
  join(
    process.cwd(),
    "src/components/shared/dialogs/record-advance-dialog.tsx",
  ),
  "utf8",
);

describe("counterparty advance balances", () => {
  it("records standalone customer and supplier advances atomically", () => {
    expect(migration).toContain("function public.record_customer_advance(");
    expect(migration).toContain("function public.record_supplier_advance(");
    expect(migration).toContain("finance.create_transaction");
    expect(migration).toContain("advance_branch_required_or_denied");
    expect(migration).toContain("customer_advance_note_required");
    expect(migration).toContain("supplier_advance_note_required");
  });

  it("keeps debt and prepayment separate in the management summary", () => {
    expect(migration).toContain(
      "function public.get_counterparty_balance_summary(",
    );
    expect(migration).toContain("'debt'");
    expect(migration).toContain("'advance'");
    expect(migration).toContain("supplier_advances");
    expect(migration).toContain("customer_debt_adjustments");
    expect(migration).toContain("p_branch_id is null or");
  });

  it("reverses standalone advances when the cash transaction is cancelled", () => {
    expect(migration).toContain("trg_reverse_direct_advance_on_cash_cancel");
    expect(migration).toContain("cancel-customer-advance:");
    expect(migration).toContain("status = 'cancelled'");
  });

  it("shows gross debt, advance and net balance in the debt workspace", () => {
    expect(workspace).toContain("customerAdvanceTotal");
    expect(workspace).toContain("supplierAdvanceTotal");
    expect(workspace).toContain("netBalance: debt - advance");
    expect(debtPage).toContain("Khách trả trước");
    expect(debtPage).toContain("Đã ứng trước");
    expect(debtPage).toContain("Số dư ròng");
  });

  it("requires an explicit branch and audit reason in the UI", () => {
    expect(advanceDialog).toContain("Hãy chọn một chi nhánh cụ thể");
    expect(advanceDialog).toContain("Nhập lý do để đối soát khoản trả trước");
    expect(advanceDialog).toContain("disabled={saving || !branchId}");
  });

  it("allows recording a deposit before any debt document exists", () => {
    expect(debtPage).toContain("Nhận tiền trước");
    expect(debtPage).toContain("Ứng trước NCC");
    expect(advanceDialog).toContain("getCustomers");
    expect(advanceDialog).toContain("getSuppliers");
    expect(advanceDialog).toContain("Hãy chọn khách hàng nhận tiền cọc");
    expect(advanceDialog).toContain(
      "Hãy chọn nhà cung cấp nhận tiền ứng trước",
    );
  });
});
