import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const debtService = readFileSync("src/lib/services/supabase/debt.ts", "utf8");
const debtPage = readFileSync("src/app/(main)/tai-chinh/cong-no/page.tsx", "utf8");
const debtWorkspace = readFileSync("src/lib/services/supabase/debt-workspace.ts", "utf8");
const tableService = readFileSync("src/lib/services/supabase/fnb-tables.ts", "utf8");
const fnbPage = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
const tableMigration = readFileSync(
  "supabase/migrations/00275_guard_fnb_table_available.sql",
  "utf8",
);

describe("branch-aware debt aging and F&B table permissions", () => {
  it("passes the selected branch to one consistent debt workspace", () => {
    expect(debtService).toContain("getDebtAging(branchId?: string | null)");
    expect(debtWorkspace).toContain("getDebtWorkspace(");
    expect(
      debtWorkspace.split(
        "getReceivableAgingReport({ branchId: branchId ?? null })",
      ),
    ).toHaveLength(2);
    expect(
      debtWorkspace.split(
        "getPayableAgingReport({ branchId: branchId ?? null })",
      ),
    ).toHaveLength(2);
    expect(debtPage).toContain("getDebtWorkspace(activeBranchId)");
    expect(debtPage).not.toContain("getDebtTotals(activeBranchId)");
    expect(debtPage).not.toContain('mode === "aging" ? activeBranchId : null');
    expect(debtPage).toContain("Phạm vi số liệu:");
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
      "Tài khoản không có quyền xem toàn công ty. Hãy chọn chi nhánh được phân quyền.",
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
    expect(fnbPage).toContain("Không có quyền quản lý bàn");
  });
});
