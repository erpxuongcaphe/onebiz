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
    expect(selector).toContain('value={activeBranchId ?? ""}');
    expect(selector).toContain("Toàn công ty");
    expect(selector).not.toContain("selectedBranchId");
    expect(selector).not.toContain("To?n c?ng ty");
  });


  it("requires the dedicated capability for full-detail export", () => {
    const header = source(
      "src/components/shared/report/report-page-header.tsx",
    );
    expect(header).toContain("PERMISSIONS.REPORTS_EXPORT_DETAIL");
    expect(header).toContain("canExportFull && onExportFull");
  });

});
