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
    expect(debtPage).toContain("Phạm vi số liệu:");
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
