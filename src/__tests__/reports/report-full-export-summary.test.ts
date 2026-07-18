import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SUMMARY_REPORTS = [
  "canh-bao",
  "customer-cohort",
  "fnb-modifier",
  "kiem-ke",
  "lot-traceability",
  "chenh-lech-kiem-ke",
] as const;

function reportSource(report: (typeof SUMMARY_REPORTS)[number]): string {
  return readFileSync(
    resolve(`src/app/(main)/phan-tich/${report}/page.tsx`),
    "utf8",
  );
}

describe("full export KPI summaries", () => {
  it.each(SUMMARY_REPORTS)(
    "adds a numeric summary sheet to %s",
    (report) => {
      const source = reportSource(report);

      expect(source).toContain("buildMetricSummarySheet");
      expect(source).toContain("format:");
      expect(source).toContain("onExportFull=");
    },
  );

  it("keeps current-view exports separate from full KPI workbooks", () => {
    for (const report of SUMMARY_REPORTS.slice(0, 5)) {
      expect(reportSource(report)).toContain('mode === "full"');
    }
  });

  it("includes cash-flow details in full finance workbooks", () => {
    const finance = readFileSync(
      resolve("src/app/(main)/phan-tich/tai-chinh/page.tsx"),
      "utf8",
    );
    const cashFlow = readFileSync(
      resolve("src/app/(main)/phan-tich/luong-tien/page.tsx"),
      "utf8",
    );

    expect(finance).toContain("cashFlowSheet");
    expect(finance).toContain("Dòng tiền ròng");
    expect(finance).not.toContain("getMonthlyProfit(");
    expect(cashFlow).toContain("categoryDetail");
    expect(cashFlow).toContain("Chi tiết thu chi theo danh mục".toUpperCase());
  });
});
