import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/constants";
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  REPORT_WORKFLOWS,
  canAccessReport,
  getReportByPath,
  searchReports,
} from "@/lib/reports/catalog";

describe("report catalog", () => {
  it("registers every report route once", () => {
    const paths = REPORT_CATALOG.map((report) => report.href);

    expect(REPORT_CATALOG).toHaveLength(36);
    expect(new Set(paths).size).toBe(paths.length);
    expect(getReportByPath("/phan-tich/khach-san-pham")?.title).toBe(
      "Khách hàng mua sản phẩm nào",
    );
  });

  it("assigns every report to a known category", () => {
    const categoryIds = new Set(REPORT_CATEGORIES.map((category) => category.id));

    expect(
      REPORT_CATALOG.every((report) => categoryIds.has(report.category)),
    ).toBe(true);
  });

  it("keeps workflow shortcuts linked to registered reports", () => {
    const paths = new Set(REPORT_CATALOG.map((report) => report.href));

    expect(REPORT_WORKFLOWS).toHaveLength(6);
    for (const workflow of REPORT_WORKFLOWS) {
      expect(workflow.reportPaths.length).toBeGreaterThanOrEqual(4);
      expect(new Set(workflow.reportPaths).size).toBe(workflow.reportPaths.length);
      expect(workflow.reportPaths.every((path) => paths.has(path))).toBe(true);
    }
  });
  it("finds reports from business-language and accentless queries", () => {
    expect(searchReports(REPORT_CATALOG, "khach mua gi")[0]?.href).toBe(
      "/phan-tich/khach-san-pham",
    );
    expect(
      searchReports(REPORT_CATALOG, "gia von").some(
        (report) => report.href === "/phan-tich/bao-cao-tai-chinh",
      ),
    ).toBe(true);
  });

  it("uses effective permissions instead of job titles", () => {
    const fnb = getReportByPath("/phan-tich/fnb");
    const pnl = getReportByPath("/phan-tich/bao-cao-tai-chinh");
    if (!fnb || !pnl) throw new Error("Missing report fixtures");

    expect(
      canAccessReport(fnb, (permission) => permission === PERMISSIONS.REPORTS_FNB),
    ).toBe(true);
    expect(
      canAccessReport(pnl, (permission) => permission === PERMISSIONS.REPORTS_ANALYTICS),
    ).toBe(false);
    expect(
      canAccessReport(
        pnl,
        (permission) =>
          permission === PERMISSIONS.REPORTS_ANALYTICS ||
          permission === PERMISSIONS.REPORTS_VIEW_PROFIT,
      ),
    ).toBe(true);
  });
});
