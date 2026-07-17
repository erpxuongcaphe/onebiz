import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMetricSummarySheet,
  ensureFullExportInfoSheet,
  filterExcelSheetColumns,
  type ExcelSheet,
  type ExportOptions,
} from "@/lib/utils/excel-export";

const detailSheet: ExcelSheet = {
  name: "Chi tiết",
  columns: [{ label: "Mã", key: "code" }],
  rows: [{ code: "HD001" }],
};

function options(mode: "view" | "full", sheets = [detailSheet]): ExportOptions {
  return {
    kind: "ban-hang",
    mode,
    range: { from: "2026-07-01", to: "2026-07-31" },
    branchName: "Chi nhánh trung tâm",
    sheets,
  };
}

describe("full report export metadata", () => {
  it("keeps view exports as a single mirror sheet", () => {
    expect(ensureFullExportInfoSheet(options("view"))).toEqual([detailSheet]);
  });

  it("prepends report scope metadata to a full export", () => {
    const sheets = ensureFullExportInfoSheet(options("full"));

    expect(sheets).toHaveLength(2);
    expect(sheets[0].name).toBe("Thông tin");
    expect(sheets[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Chi nhánh",
          value: "Chi nhánh trung tâm",
        }),
        expect.objectContaining({
          label: "Múi giờ",
          value: "Asia/Ho_Chi_Minh",
        }),
      ]),
    );
    expect(sheets[1]).toBe(detailSheet);
  });

  it("does not duplicate an existing info sheet", () => {
    const existingInfo: ExcelSheet = {
      name: "Thông tin",
      columns: [{ label: "Mục", key: "label" }],
      rows: [],
    };
    const sheets = ensureFullExportInfoSheet(
      options("full", [existingInfo, detailSheet]),
    );

    expect(sheets).toEqual([existingInfo, detailSheet]);
  });

  it("loads the Excel libraries only after an export action", () => {
    const source = readFileSync("src/lib/utils/excel-export.ts", "utf8");

    expect(source).toContain('import("xlsx-js-style")');
    expect(source).toContain('import("file-saver")');
    expect(source).not.toContain('import * as XLSX from "xlsx-js-style"');
  });
});

describe("current-view export columns", () => {
  const groupedSheet: ExcelSheet = {
    name: "Stock",
    columns: [
      { label: "Code", key: "code" },
      { label: "Name", key: "name" },
      { label: "Quantity", key: "quantity" },
      { label: "Value", key: "value" },
    ],
    columnGroups: [
      { label: "Product", span: 2 },
      { label: "Inventory", span: 2 },
    ],
    rows: [{ code: "SP01", name: "Coffee", quantity: 2, value: 100 }],
  };

  it("keeps the first identifying column and removes hidden columns", () => {
    const filtered = filterExcelSheetColumns(groupedSheet, [
      "code",
      "name",
      "quantity",
    ]);

    expect(filtered.columns.map((column) => column.key)).toEqual([
      "code",
      "value",
    ]);
  });

  it("recalculates grouped headers after columns are hidden", () => {
    const filtered = filterExcelSheetColumns(groupedSheet, ["name", "value"]);

    expect(filtered.columnGroups).toEqual([
      { label: "Product", span: 1 },
      { label: "Inventory", span: 1 },
    ]);
  });
});

describe("metric summary sheets", () => {
  it("keeps KPI values numeric and separates their units", () => {
    const sheet = buildMetricSummarySheet({
      metrics: [
        { label: "Orders", value: 12, format: "number" },
        { label: "Revenue", value: 1250000, format: "currency" },
        { label: "Retention", value: 32.5, format: "percent" },
      ],
    });

    expect(sheet.name).toBe("Tóm tắt");
    expect(sheet.columns.map((column) => column.format)).toEqual([
      undefined,
      "number",
      "currency",
      "percent",
      undefined,
    ]);
    expect(sheet.rows).toEqual([
      expect.objectContaining({
        label: "Orders",
        numberValue: 12,
        currencyValue: "",
      }),
      expect.objectContaining({
        label: "Revenue",
        currencyValue: 1250000,
      }),
      expect.objectContaining({
        label: "Retention",
        percentValue: 32.5,
      }),
    ]);
  });
});
