import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceService = readFileSync(
  "src/lib/services/supabase/debt-workspace.ts",
  "utf8",
);
const debtPage = readFileSync(
  "src/app/(main)/tai-chinh/cong-no/page.tsx",
  "utf8",
);
const paymentsService = readFileSync(
  "src/lib/services/supabase/payments.ts",
  "utf8",
);
const detailDialog = readFileSync(
  "src/components/shared/dialogs/debt-detail-dialog.tsx",
  "utf8",
);
const settleDialog = readFileSync(
  "src/components/shared/dialogs/settle-debt-dialog.tsx",
  "utf8",
);

describe("branch-scoped debt workspace", () => {
  it("loads receivable and payable reports once for one consistent snapshot", () => {
    expect(
      workspaceService.split(
        "getReceivableAgingReport({ branchId: branchId ?? null })",
      ),
    ).toHaveLength(2);
    expect(
      workspaceService.split(
        "getPayableAgingReport({ branchId: branchId ?? null })",
      ),
    ).toHaveLength(2);
    expect(workspaceService).not.toContain(".insert(");
    expect(workspaceService).not.toContain(".update(");
    expect(workspaceService).not.toContain(".delete(");
  });

  it("uses the same branch workspace for KPI, tables, aging and exports", () => {
    expect(debtPage).toContain("getDebtWorkspace(activeBranchId)");
    expect(debtPage).toContain("workspace?.totals.customerDebtTotal");
    expect(debtPage).toContain("workspace?.receivables");
    expect(debtPage).toContain("workspace?.payables");
    expect(debtPage).toContain("exportToCsv(receivableDebtors");
    expect(debtPage).toContain("exportToCsv(payableDebtors");
    expect(debtPage).not.toContain("getCustomers(");
    expect(debtPage).not.toContain("getSuppliers(");
    expect(debtPage).not.toContain("getDebtTotals(");
  });

  it("ignores late responses when the selected branch changes", () => {
    expect(debtPage).toContain("const requestId = ++requestIdRef.current");
    expect(debtPage).toContain("requestId !== requestIdRef.current");
    expect(debtPage).toContain("setWorkspace(null)");
  });

  it("blocks settle/detail actions for walk-in receivable rows", () => {
    // Khách lẻ walk-in:* không phải UUID — mở dialog sẽ lỗi 22P02
    expect(debtPage).toContain('row.original.id.startsWith("walk-in:")');
    // Service không được query bảng customers bằng ID walk-in
    expect(workspaceService).toContain('!id.startsWith("walk-in:")');
  });

  it("scopes debt details and settlement documents to the selected branch", () => {
    expect(paymentsService).toContain("branchId?: string | null");
    expect(paymentsService.split('query.eq("branch_id", branchId)')).toHaveLength(3);
    expect(detailDialog).toContain(
      "getOpenInvoicesByCustomer(partyId, branchId)",
    );
    expect(detailDialog).toContain(
      "getOpenPurchasesBySupplier(partyId, branchId)",
    );
    expect(settleDialog).toContain(
      "getOpenInvoicesByCustomer(partyId, branchId)",
    );
    expect(settleDialog).toContain(
      "getOpenPurchasesBySupplier(partyId, branchId)",
    );
    expect(debtPage.split("branchId={activeBranchId}")).toHaveLength(3);
  });
});