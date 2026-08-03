
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const debtService = readFileSync("src/lib/services/supabase/debt.ts", "utf8");
const debtPage = readFileSync("src/app/(main)/tai-chinh/cong-no/page.tsx", "utf8");
const tableService = readFileSync("src/lib/services/supabase/fnb-tables.ts", "utf8");
const fnbPage = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
const tableMigration = readFileSync(
  "supabase/migrations/00275_guard_fnb_table_available.sql",
  "utf8",
);

describe("branch-aware debt aging and F&B table permissions", () => {
  it("passes the selected branch to both debt sides", () => {
    expect(debtService).toContain("getDebtAging(branchId?: string | null)");
    expect(debtService).toContain("getTopDebtors(");
    expect(debtService).toContain("branchId?: string | null");
    expect(debtService.split("getReceivableAgingReport({ branchId: branchId ?? null })")).toHaveLength(4);
    expect(debtService.split("getPayableAgingReport({ branchId: branchId ?? null })")).toHaveLength(4);
    expect(debtPage).toContain("getDebtAging(activeBranchId)");
    expect(debtPage).toContain("getTopDebtors(20, activeBranchId)");
    expect(debtPage).toContain("getDebtTotals(activeBranchId)");
    expect(debtPage).not.toContain('mode === "aging" ? activeBranchId : null');
    expect(debtPage).toContain("Pháº¡m vi sá»‘ liá»‡u:");
  });

  it("never restores or selects all branches without the effective permission", () => {
    const authContext = readFileSync(
      "src/lib/contexts/auth-context.tsx",
      "utf8",
    );
    expect(authContext).toContain("function canViewAllBranches(");
    expect(authContext).toContain("PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES");
    expect(authContext).toContain("PERMISSIONS.SYSTEM_MANAGE_BRANCHES");
    expect(authContext).toContain('storedBranchId === "__all__" &&');
    expect(authContext).toContain('branchId === null &&');
    expect(authContext).toContain("!canViewAllBranches(user?.role, permissions)");
  });

  it("turns report scope denials into an actionable Vietnamese message", () => {
    const reportService = readFileSync(
      "src/lib/services/supabase/finance-marketing-reports.ts",
      "utf8",
    );
    expect(reportService).toContain("REPORT_ALL_BRANCHES_DENIED");
    expect(reportService).toContain(
      "TÃ i khoáº£n khÃ´ng cÃ³ quyá»n xem toÃ n cÃ´ng ty. HÃ£y chá»n chi nhÃ¡nh Ä‘Æ°á»£c phÃ¢n quyá»n.",
    );
  });

  it("changes a cleaned table through an authorized server lock", () => {
    expect(tableService).toContain('"mark_fnb_table_available_atomic"');
    expect(tableMigration).toContain("for update");
    expect(tableMigration).toContain("pos_fnb.manage_tables");
    expect(tableMigration).toContain("user_has_branch_access");
    expect(tableMigration).toContain("TABLE_NOT_CLEANING");
    expect(tableMigration).toContain("TABLE_STILL_HAS_ORDER");
    expect(fnbPage).toContain("canManageTables");
    expect(fnbPage).toContain("KhÃ´ng cÃ³ quyá»n quáº£n lÃ½ bÃ n");
  });
});

