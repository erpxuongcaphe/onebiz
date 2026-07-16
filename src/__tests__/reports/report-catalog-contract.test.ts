import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "@/lib/reports/catalog";

function reportPagePath(href: string): string {
  return href === "/phan-tich"
    ? "src/app/(main)/phan-tich/page.tsx"
    : `src/app/(main)${href}/page.tsx`;
}

describe("report catalog implementation contract", () => {
  it("keeps all 36 catalog pages on the shared report foundation", () => {
    expect(REPORT_CATALOG).toHaveLength(36);

    for (const report of REPORT_CATALOG) {
      const source = readFileSync(resolve(reportPagePath(report.href)), "utf8");
      const expectedKind =
        report.href === "/phan-tich"
          ? "tong-quan"
          : report.href.replace("/phan-tich/", "");
      expect(source, report.href).toContain("ReportPageHeader");
      expect(source, report.href).toContain("useBranchFilter()");
      expect(source, report.href).toContain("exportReportToExcel");
      expect(source, report.href).toContain("onExportFull=");
      expect(source, report.href).toContain(`kind: "${expectedKind}"`);
      expect(source, report.href).not.toContain("Chi nh\u00e1nh \u0111ang ch\u1ecdn");
      expect(source, report.href).not.toContain("T\u00ednh n\u0103ng \u0111ang ph\u00e1t tri\u1ec3n");
      expect(source, report.href).not.toContain("setBranchId");
    }
  });

  it("gives every Recharts responsive container a stable initial size", () => {
    for (const report of REPORT_CATALOG) {
      const source = readFileSync(resolve(reportPagePath(report.href)), "utf8");
      const containers = source.match(/<ResponsiveContainer\b[^>]*>/g) ?? [];

      for (const container of containers) {
        expect(container, report.href).toContain(
          "initialDimension={{ width: 320, height: 224 }}",
        );
      }
    }
  });

  it("defines a dedicated export kind for every catalog report", () => {
    const reportTypes = readFileSync(resolve("src/lib/types/report.ts"), "utf8");
    const expectedKinds = REPORT_CATALOG.map((report) =>
      report.href === "/phan-tich"
        ? "tong-quan"
        : report.href.replace("/phan-tich/", ""),
    );

    for (const kind of expectedKinds) {
      expect(reportTypes, kind).toContain(`| "${kind}"`);
    }
  });
});
