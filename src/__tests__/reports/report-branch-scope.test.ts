import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

describe("report branch scope integration", () => {
  it("removes the conflicting local branch selector from P&L", () => {
    const page = source(
      "src/app/(main)/phan-tich/bao-cao-tai-chinh/page.tsx",
    );
    expect(page).toContain("useBranchFilter()");
    expect(page).not.toContain("setBranchId");
    expect(page).not.toContain("<Select");
  });

  it("passes effective branch scope to cohort and lot reports", () => {
    const cohort = source(
      "src/app/(main)/phan-tich/customer-cohort/page.tsx",
    );
    const lots = source(
      "src/app/(main)/phan-tich/lot-traceability/page.tsx",
    );
    expect(cohort).toContain("branchId: activeBranchId");
    expect(lots).toContain("branchId: activeBranchId");
    expect(lots).not.toContain("getExpiringLots");
    expect(lots).toContain("lot.expiryDate");
    expect(lots).toContain("lot.currentQty");
  });

  it("uses capability checks instead of profile titles for consolidated reports", () => {
    const nav = source("src/components/shared/top-nav.tsx");
    expect(nav).toContain("PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES");
    expect(nav).not.toContain('user?.role === "owner"');
    expect(nav).not.toContain('user?.role === "admin"');
  });

  it("shows all-company scope without pretending the first branch is selected", () => {
    const selector = source(
      "src/components/shared/report/report-scope-selector.tsx",
    );
    expect(selector).toContain('const ALL_BRANCHES_VALUE = "__all_branches__"');
    expect(selector).toContain("Toàn công ty");
    expect(selector).toContain("const branchItems = useMemo");
    expect(selector).toContain("const scopeItems = useMemo");
    expect(selector).toContain("value={selectedValue}");
    expect(selector).toContain("items={scopeItems}");
    expect(selector).toContain("selectBranch(value === ALL_BRANCHES_VALUE ? null : value)");
    expect(selector).not.toContain("selectedBranchId");
    expect(selector).not.toContain("aria-pressed");
    expect(selector).not.toContain("To?n c?ng ty");
  });


  it("requires the dedicated capability for full-detail export", () => {
    const header = source(
      "src/components/shared/report/report-page-header.tsx",
    );
    expect(header).toContain("PERMISSIONS.REPORTS_EXPORT_DETAIL");
    expect(header).toContain("canExportFull && onExportFull");
  });

  it("gives report charts stable initial dimensions", () => {
    const sales = source("src/app/(main)/phan-tich/ban-hang/page.tsx");
    const financial = source(
      "src/app/(main)/phan-tich/bao-cao-tai-chinh/page.tsx",
    );

    for (const page of [sales, financial]) {
      const containers = page.match(/<ResponsiveContainer/g) ?? [];
      const initialized =
        page.match(/initialDimension=\{\{ width: 320, height: 224 \}\}/g) ?? [];
      expect(initialized).toHaveLength(containers.length);
    }
  });

  it("gates and remounts reports when branch scope changes", () => {
    const hook = source("src/lib/hooks/use-report-scope.ts");
    const shell = source("src/components/shared/report/report-shell.tsx");
    const selector = source(
      "src/components/shared/report/report-scope-selector.tsx",
    );

    expect(hook).toContain("const [isInitialized, setIsInitialized]");
    expect(hook).toContain("initializedRef.current = true");
    expect(hook).toContain("isReady: authReady && isInitialized");
    expect(shell).toContain("useReportScope()");
    expect(hook).toContain("if (!synchronizeUrl || !authReady");
    expect(selector).toContain("useReportScope({ synchronizeUrl: false })");
    expect(shell).toContain("isLoading || !isScopeReady");
    expect(shell).toContain('key={activeBranchId ?? "__all__"}');
  });

});
