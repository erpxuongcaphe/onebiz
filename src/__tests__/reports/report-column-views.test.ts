import { readdirSync, readFileSync } from "node:fs";
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

  it("gives every standard report table a stable and unique preference key", () => {
    const root = "src/app/(main)/phan-tich";
    const pageFiles: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = directory + "/" + entry.name;
        if (entry.isDirectory()) walk(path);
        else if (entry.name === "page.tsx") pageFiles.push(path);
      }
    };
    walk(root);

    const keys: string[] = [];
    for (const path of pageFiles) {
      const source = readFileSync(path, "utf8");
      const dataTables =
        source.match(/<ReportDataTable\b[\s\S]*?\/>/g) ?? [];
      const tableFrames = source.match(/<ReportTableFrame\b[^>]*>/g) ?? [];
      for (const table of [...dataTables, ...tableFrames]) {
        const match = table.match(/tablePreferenceKey="([^"]+)"/);
        expect(match, path).not.toBeNull();
        keys.push(match![1]);
      }

      const nativeTableCount = source.match(/<table\b/g)?.length ?? 0;
      const hasSpecializedColumnPicker = source.includes(
        "CUSTOMER_COLUMN_OPTIONS",
      );
      if (nativeTableCount > 0 && !hasSpecializedColumnPicker) {
        expect(tableFrames.length, path).toBe(nativeTableCount);
      }
    }

    expect(keys.length).toBeGreaterThan(30);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("scopes legacy-table display rules to one table frame", () => {
    const source = readFileSync(
      "src/components/shared/report/report-table-frame.tsx",
      "utf8",
    );
    expect(source).toContain("data-report-table-scope");
    expect(source).toContain("MutationObserver");
    expect(source).toContain("hiddenIndexes");
    expect(source).toContain("first-of-type");
  });
});
