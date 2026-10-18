import type { ExcelSheet } from "@/lib/utils/excel-export";

export function financialExportSheets(sheets: ExcelSheet[], titleRows: string[]): ExcelSheet[] {
  return sheets.map(sheet => ({
    ...sheet,
    titleRows: sheet.titleRows ?? titleRows,
    columns: sheet.columns.map(column => column.format === "currency"
      ? { ...column, label: `${column.label} (đ)`, format: "number" as const, decimalPlaces: 2 }
      : column.format === "number"
        ? { ...column, decimalPlaces: column.decimalPlaces ?? 4 }
        : column),
  }));
}
