import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tableSource = readFileSync(
  "src/components/shared/report/report-data-table.tsx",
  "utf8",
);
const exportSource = readFileSync("src/lib/utils/excel-export.ts", "utf8");

const integrations = [
  ["ban-hang", "report.ban-hang.daily-revenue"],
  ["cuoi-ngay", "report.cuoi-ngay.payments"],
  ["abc-analysis", "report.abc-analysis.products"],
  ["lot-traceability", "report.lot-traceability.lots"],
  ["kiem-ke", "report.kiem-ke.checks"],
  ["xuat-nhap-ton", "report.xuat-nhap-ton.summary"],
  ["xuat-nhap-ton", "report.xuat-nhap-ton.detail"],
] as const;

describe("report column views", () => {
  it("offers a persistent column picker and keeps one identifying column", () => {
    expect(tableSource).toContain("hiddenColumnKeys");
    expect(tableSource).toContain("DropdownMenuSubContent");
    expect(tableSource).toContain("index === 0");
    expect(tableSource).toContain("showAllColumns");
  });

  it("filters only current-view Excel sheets", () => {
    expect(exportSource).toContain("options.mode");
    expect(exportSource).toContain("filterExcelSheetColumns");
    expect(exportSource).toContain("sheet.tablePreferenceKey");
  });

  it.each(integrations)(
    "shares the %s table key with its current-view export",
    (report, key) => {
      const source = readFileSync(
        "src/app/(main)/phan-tich/" + report + "/page.tsx",
        "utf8",
      );
      expect(source.split(key).length - 1).toBeGreaterThanOrEqual(2);
    },
  );
});
