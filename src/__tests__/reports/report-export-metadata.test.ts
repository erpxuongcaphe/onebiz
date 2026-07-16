import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ensureFullExportInfoSheet,
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
