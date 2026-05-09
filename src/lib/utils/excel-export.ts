/**
 * Excel export helpers cho báo cáo phân tích.
 *
 * Pattern KiotViet (CEO 06/05/2026):
 * - 2 mode export song song:
 *   1. **View** — mirror đúng view hiện tại trên web (1 sheet, gọn)
 *   2. **Full** — multi-sheet với mọi dimension cho kế toán pivot
 *
 * Lib: xlsx (đã có trong package.json) + file-saver.
 *
 * Convention:
 * - Filename: `bao-cao-{kind}-{view|full}-{from}_{to}.xlsx`
 * - Number format chuẩn VN (chấm phân cách nghìn) thông qua cellStyle
 * - Header rows merged cells cho group columns (NHẬP / XUẤT)
 * - Footer subtotal row "Tổng cộng: N mặt hàng" hoặc "SL HĐ: N"
 */

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import type { DateRange, ReportKind } from "@/lib/types/report";
import { formatDate } from "@/lib/format";

// ============================================================
// Sheet schema — mỗi sheet = 1 bảng độc lập
// ============================================================

export interface ExcelColumn {
  /** Header label hiển thị Excel */
  label: string;
  /** Key trong data row */
  key: string;
  /** Width in chars (default 15) */
  width?: number;
  /** Format số: "number" | "currency" | "date" | "text" */
  format?: "number" | "currency" | "date" | "text";
}

export interface ExcelSheet {
  /** Sheet name (max 31 chars per Excel spec) */
  name: string;
  /** Title rows hiển thị trên cùng (merged across all columns) */
  titleRows?: string[];
  /** Column groups — merged header trên row 1 (vd "NHẬP" / "XUẤT") */
  columnGroups?: { label: string; span: number }[];
  /** Column definitions */
  columns: ExcelColumn[];
  /** Data rows */
  rows: Record<string, unknown>[];
  /** Footer subtotal row (optional) */
  footer?: Record<string, unknown>;
  /** Footer label (vd "Tổng cộng" hoặc "SL mặt hàng: 201") */
  footerLabel?: string;
}

// ============================================================
// Build worksheet from schema
// ============================================================

function buildWorksheet(sheet: ExcelSheet): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  let row = 0;

  // Title rows (merged across all columns)
  const totalCols = sheet.columns.length;
  if (sheet.titleRows) {
    for (const title of sheet.titleRows) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 0 });
      ws[cellRef] = {
        v: title,
        t: "s",
        s: { font: { bold: true, sz: 14 }, alignment: { horizontal: "center" } },
      };
      merges.push({
        s: { r: row, c: 0 },
        e: { r: row, c: totalCols - 1 },
      });
      row++;
    }
    row++; // empty separator row
  }

  // Column groups (merged header)
  if (sheet.columnGroups && sheet.columnGroups.length > 0) {
    let colCursor = 0;
    for (const group of sheet.columnGroups) {
      if (group.span > 1) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: colCursor });
        ws[cellRef] = {
          v: group.label,
          t: "s",
          s: { font: { bold: true }, alignment: { horizontal: "center" } },
        };
        merges.push({
          s: { r: row, c: colCursor },
          e: { r: row, c: colCursor + group.span - 1 },
        });
      } else if (group.span === 1) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: colCursor });
        ws[cellRef] = { v: group.label, t: "s", s: { font: { bold: true } } };
      }
      colCursor += group.span;
    }
    row++;
  }

  // Column header row
  for (let c = 0; c < sheet.columns.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c });
    ws[cellRef] = {
      v: sheet.columns[c].label,
      t: "s",
      s: { font: { bold: true }, fill: { fgColor: { rgb: "E8EEFD" } } },
    };
  }
  row++;

  // Footer subtotal (top — KiotViet pattern: subtotal ở đầu danh sách)
  if (sheet.footer) {
    const labelRef = XLSX.utils.encode_cell({ r: row, c: 0 });
    ws[labelRef] = {
      v: sheet.footerLabel ?? "Tổng cộng",
      t: "s",
      s: { font: { bold: true } },
    };
    for (let c = 0; c < sheet.columns.length; c++) {
      const col = sheet.columns[c];
      const value = sheet.footer[col.key];
      if (value != null && c > 0) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c });
        ws[cellRef] = formatCell(value, col.format);
        ws[cellRef].s = { font: { bold: true } };
      }
    }
    row++;
  }

  // Data rows
  for (const dataRow of sheet.rows) {
    for (let c = 0; c < sheet.columns.length; c++) {
      const col = sheet.columns[c];
      const value = dataRow[col.key];
      if (value != null) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c });
        ws[cellRef] = formatCell(value, col.format);
      }
    }
    row++;
  }

  // Set range
  const lastRow = row - 1;
  const lastCol = totalCols - 1;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: lastCol },
  });

  // Column widths
  ws["!cols"] = sheet.columns.map((col) => ({ wch: col.width ?? 15 }));

  // Merges
  if (merges.length > 0) ws["!merges"] = merges;

  return ws;
}

function formatCell(
  value: unknown,
  format: ExcelColumn["format"],
): XLSX.CellObject {
  if (format === "number" || format === "currency") {
    const n = typeof value === "number" ? value : Number(value);
    return {
      v: Number.isFinite(n) ? n : 0,
      t: "n",
      z: format === "currency" ? "#,##0" : "#,##0.##",
    };
  }
  if (format === "date") {
    return { v: String(value), t: "s" };
  }
  return { v: String(value), t: "s" };
}

// ============================================================
// Public API
// ============================================================

export interface ExportOptions {
  kind: ReportKind;
  /** view = 1 sheet mirror; full = multi-sheet */
  mode: "view" | "full";
  /** Date range — dùng cho filename + title row */
  range: DateRange;
  /** Branch name (vd "Chi nhánh trung tâm") cho title row */
  branchName?: string;
  /** Sheets to export — caller cung cấp */
  sheets: ExcelSheet[];
}

/**
 * Generate Excel file và download.
 *
 * @example
 *   exportReportToExcel({
 *     kind: "xuat-nhap-ton",
 *     mode: "view",
 *     range: { from: "2026-05-01", to: "2026-05-06" },
 *     branchName: "Kho tổng",
 *     sheets: [{ name: "XNT", columns: [...], rows: [...] }],
 *   });
 */
export function exportReportToExcel(options: ExportOptions): void {
  const wb = XLSX.utils.book_new();

  for (const sheet of options.sheets) {
    const ws = buildWorksheet(sheet);
    // Excel sheet name max 31 chars, no special chars / : ? * [ ]
    const safeName = sheet.name
      .replace(/[\\/:*?[\]]/g, "")
      .substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  const filename = buildFilename(options);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, filename);
}

function buildFilename(options: ExportOptions): string {
  const { kind, mode, range } = options;
  const fromShort = range.from.replace(/-/g, "");
  const toShort = range.to.replace(/-/g, "");
  const modeLabel = mode === "full" ? "day-du" : "view";
  return `bao-cao-${kind}-${modeLabel}-${fromShort}_${toShort}.xlsx`;
}

// ============================================================
// Helpers — title rows builder
// ============================================================

export function buildReportTitleRows(args: {
  title: string;
  range: DateRange;
  branchName?: string;
  generatedAt?: Date;
}): string[] {
  const fmtRange = (() => {
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split("-");
      return `${d}/${m}/${y}`;
    };
    return `Từ ngày ${fmt(args.range.from)} đến ngày ${fmt(args.range.to)}`;
  })();

  const rows = [args.title, fmtRange];
  if (args.branchName) rows.push(`Chi nhánh: ${args.branchName}`);
  if (args.generatedAt) {
    const ts = formatDate(args.generatedAt);
    rows.push(`Ngày lập: ${ts}`);
  }
  return rows;
}
