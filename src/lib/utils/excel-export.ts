/**
 * Excel export helpers cho báo cáo phân tích (CEO 14/05/2026 — refactor).
 *
 * Pattern KiotViet + chuẩn báo cáo tài chính VN:
 * - 2 mode export song song:
 *   1. **View** — mirror đúng view hiện tại trên web (1 sheet, gọn)
 *   2. **Full** — multi-sheet với mọi dimension cho kế toán pivot
 *
 * Lib: xlsx-js-style (fork miễn phí của SheetJS, hỗ trợ cell styling đầy
 * đủ — fill, font, border, alignment, number format). Pro version SheetJS
 * tốn ~$300/mo nên dùng community fork.
 *
 * Convention:
 * - Filename: `bao-cao-{kind}-{view|full}-{from}_{to}.xlsx`
 * - VND format: `#,##0` (chấm phân cách nghìn, không decimal)
 * - Percentage format: `0.0%`
 * - Title row: bold 16pt, primary color background, white text
 * - Section header: bold 12pt, light blue background
 * - Column header: bold 11pt, gray background, border bottom
 * - Total row: bold 11pt, light yellow background, top border
 * - Data row: 10pt, alternating row color (optional)
 * - All cells có thin border + center alignment cho number cells
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import type { DateRange, ReportKind } from "@/lib/types/report";

// ============================================================
// Style constants — đồng bộ với theme OneBiz (#004AC6 primary)
// ============================================================

const COLOR_PRIMARY = "004AC6"; // OneBiz blue
const COLOR_PRIMARY_LIGHT = "E8EEFD";
const COLOR_HEADER_BG = "1E3A8A"; // Dark blue cho title block
const COLOR_SECTION_BG = "DBEAFE"; // Light blue cho section divider
const COLOR_COLUMN_HEADER = "F1F5F9"; // Gray light cho column header
const COLOR_TOTAL_BG = "FEF3C7"; // Light yellow cho total/footer row
const COLOR_BORDER = "CBD5E1"; // Slate gray
const COLOR_TEXT_MUTED = "64748B";

const FONT_FAMILY = "Calibri";

// Reusable style fragments
const BORDER_THIN = {
  top: { style: "thin" as const, color: { rgb: COLOR_BORDER } },
  bottom: { style: "thin" as const, color: { rgb: COLOR_BORDER } },
  left: { style: "thin" as const, color: { rgb: COLOR_BORDER } },
  right: { style: "thin" as const, color: { rgb: COLOR_BORDER } },
};

const STYLE_TITLE = {
  font: {
    name: FONT_FAMILY,
    bold: true,
    sz: 16,
    color: { rgb: "FFFFFF" },
  },
  fill: { fgColor: { rgb: COLOR_HEADER_BG }, patternType: "solid" },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: BORDER_THIN,
};

const STYLE_SUBTITLE = {
  font: { name: FONT_FAMILY, italic: true, sz: 11, color: { rgb: COLOR_TEXT_MUTED } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
};

const STYLE_SECTION = {
  font: { name: FONT_FAMILY, bold: true, sz: 12, color: { rgb: COLOR_PRIMARY } },
  fill: { fgColor: { rgb: COLOR_SECTION_BG }, patternType: "solid" },
  alignment: { horizontal: "left" as const, vertical: "center" as const },
  border: BORDER_THIN,
};

const STYLE_COL_HEADER = {
  font: { name: FONT_FAMILY, bold: true, sz: 11, color: { rgb: "1F2937" } },
  fill: { fgColor: { rgb: COLOR_COLUMN_HEADER }, patternType: "solid" },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border: BORDER_THIN,
};

const STYLE_TOTAL = {
  font: { name: FONT_FAMILY, bold: true, sz: 11, color: { rgb: "1F2937" } },
  fill: { fgColor: { rgb: COLOR_TOTAL_BG }, patternType: "solid" },
  border: {
    ...BORDER_THIN,
    top: { style: "medium" as const, color: { rgb: COLOR_PRIMARY } },
  },
};

const STYLE_DATA_TEXT = {
  font: { name: FONT_FAMILY, sz: 10 },
  alignment: { horizontal: "left" as const, vertical: "center" as const, wrapText: true },
  border: BORDER_THIN,
};

const STYLE_DATA_NUMBER = {
  font: { name: FONT_FAMILY, sz: 10 },
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  border: BORDER_THIN,
};

const STYLE_DATA_CENTER = {
  font: { name: FONT_FAMILY, sz: 10 },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: BORDER_THIN,
};

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
  /** Format số: "number" | "currency" | "percent" | "date" | "text" */
  format?: "number" | "currency" | "percent" | "date" | "text";
  /** Alignment: "left" | "center" | "right". Default theo format. */
  align?: "left" | "center" | "right";
}

export interface ExcelSection {
  /** Section label hiển thị trên 1 row merged (vd "DOANH THU") */
  label: string;
  /** Số column span (mặc định toàn bộ columns) */
  span?: number;
}

export interface ExcelSheet {
  /** Sheet name (max 31 chars per Excel spec) */
  name: string;
  /** Title rows hiển thị trên cùng (merged across all columns). Row đầu = title chính (bg đậm), các row sau = info phụ. */
  titleRows?: string[];
  /** Column groups — merged header trên row 1 (vd "NHẬP" / "XUẤT") */
  columnGroups?: { label: string; span: number }[];
  /** Column definitions */
  columns: ExcelColumn[];
  /** Data rows */
  rows: Record<string, unknown>[];
  /**
   * Section breaks: insert 1 row merged label trước row index N.
   * Vd: { 5: "CHI PHÍ" } → trước row data[5] thêm 1 row "CHI PHÍ".
   */
  sections?: Record<number, string>;
  /** Footer subtotal row (optional) */
  footer?: Record<string, unknown>;
  /** Footer label (vd "Tổng cộng" hoặc "SL mặt hàng: 201") */
  footerLabel?: string;
  /**
   * Có hiển thị block signature ở cuối không? Default false.
   * Khi true: tạo 3 cột "Người lập / Kế toán trưởng / Giám đốc" cuối sheet.
   */
  withSignature?: boolean;
}

// ============================================================
// Build worksheet from schema
// ============================================================

function buildWorksheet(sheet: ExcelSheet): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const rowHeights: { hpt: number }[] = [];
  let row = 0;

  const totalCols = sheet.columns.length;

  // ───── Title block ─────
  // Row 0 = title chính (big, primary bg). Row 1+ = info phụ (italic, muted)
  if (sheet.titleRows && sheet.titleRows.length > 0) {
    // Row 0: title chính
    const titleRef = XLSX.utils.encode_cell({ r: row, c: 0 });
    ws[titleRef] = { v: sheet.titleRows[0], t: "s", s: STYLE_TITLE };
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: totalCols - 1 } });
    rowHeights[row] = { hpt: 28 }; // Title row cao 28pt
    row++;

    // Các row sau: subtitle (italic, smaller)
    for (let i = 1; i < sheet.titleRows.length; i++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 0 });
      ws[cellRef] = { v: sheet.titleRows[i], t: "s", s: STYLE_SUBTITLE };
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: totalCols - 1 } });
      rowHeights[row] = { hpt: 18 };
      row++;
    }
    row++; // empty separator row
  }

  // ───── Column groups ─────
  if (sheet.columnGroups && sheet.columnGroups.length > 0) {
    let colCursor = 0;
    for (const group of sheet.columnGroups) {
      if (group.span > 1) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: colCursor });
        ws[cellRef] = { v: group.label, t: "s", s: STYLE_SECTION };
        merges.push({
          s: { r: row, c: colCursor },
          e: { r: row, c: colCursor + group.span - 1 },
        });
      } else if (group.span === 1) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: colCursor });
        ws[cellRef] = { v: group.label, t: "s", s: STYLE_SECTION };
      }
      colCursor += group.span;
    }
    row++;
  }

  // ───── Column header row ─────
  for (let c = 0; c < sheet.columns.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c });
    ws[cellRef] = { v: sheet.columns[c].label, t: "s", s: STYLE_COL_HEADER };
  }
  rowHeights[row] = { hpt: 22 };
  row++;

  // ───── Data rows (with optional section breaks) ─────
  for (let i = 0; i < sheet.rows.length; i++) {
    // Insert section header trước row i nếu có
    if (sheet.sections?.[i]) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 0 });
      ws[cellRef] = { v: sheet.sections[i], t: "s", s: STYLE_SECTION };
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: totalCols - 1 } });
      row++;
    }

    const dataRow = sheet.rows[i];
    for (let c = 0; c < sheet.columns.length; c++) {
      const col = sheet.columns[c];
      const value = dataRow[col.key];
      const cellRef = XLSX.utils.encode_cell({ r: row, c });
      ws[cellRef] = formatCell(value, col);
    }
    row++;
  }

  // ───── Footer total ─────
  if (sheet.footer) {
    // Label cell ở cột đầu
    const labelRef = XLSX.utils.encode_cell({ r: row, c: 0 });
    ws[labelRef] = {
      v: sheet.footerLabel ?? (sheet.footer[sheet.columns[0].key] ?? "TỔNG CỘNG"),
      t: "s",
      s: STYLE_TOTAL,
    };
    for (let c = 1; c < sheet.columns.length; c++) {
      const col = sheet.columns[c];
      const value = sheet.footer[col.key];
      const cellRef = XLSX.utils.encode_cell({ r: row, c });
      const cell = formatCell(value, col);
      ws[cellRef] = { ...cell, s: STYLE_TOTAL };
    }
    rowHeights[row] = { hpt: 22 };
    row++;
  }

  // ───── Signature block (3 cột) ─────
  if (sheet.withSignature && totalCols >= 3) {
    row += 2; // 2 empty rows
    const sigRow = row;
    const positions = [0, Math.floor(totalCols / 2), totalCols - 1];
    const labels = ["Người lập", "Kế toán trưởng", "Giám đốc"];
    for (let i = 0; i < 3; i++) {
      const labelRef = XLSX.utils.encode_cell({ r: sigRow, c: positions[i] });
      ws[labelRef] = {
        v: labels[i],
        t: "s",
        s: {
          font: { name: FONT_FAMILY, bold: true, sz: 11 },
          alignment: { horizontal: "center" as const },
        },
      };
      const noteRef = XLSX.utils.encode_cell({ r: sigRow + 1, c: positions[i] });
      ws[noteRef] = {
        v: "(Ký, ghi rõ họ tên)",
        t: "s",
        s: {
          font: { name: FONT_FAMILY, italic: true, sz: 9, color: { rgb: COLOR_TEXT_MUTED } },
          alignment: { horizontal: "center" as const },
        },
      };
    }
    row += 5; // 5 row trống cho chữ ký
  }

  // ───── Set range ─────
  const lastRow = row - 1;
  const lastCol = totalCols - 1;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: lastCol },
  });

  // Column widths
  ws["!cols"] = sheet.columns.map((col) => ({ wch: col.width ?? 15 }));

  // Row heights
  ws["!rows"] = rowHeights;

  // Merges
  if (merges.length > 0) ws["!merges"] = merges;

  return ws;
}

function formatCell(value: unknown, col: ExcelColumn): XLSX.CellObject {
  const format = col.format ?? "text";
  const isNumber = format === "number" || format === "currency" || format === "percent";

  // Empty / null
  if (value == null || value === "") {
    return {
      v: "",
      t: "s",
      s: isNumber ? STYLE_DATA_NUMBER : STYLE_DATA_TEXT,
    };
  }

  if (format === "currency") {
    const n = typeof value === "number" ? value : Number(value);
    return {
      v: Number.isFinite(n) ? n : 0,
      t: "n",
      z: "#,##0",
      s: STYLE_DATA_NUMBER,
    };
  }

  if (format === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return {
      v: Number.isFinite(n) ? n : 0,
      t: "n",
      z: "#,##0.##",
      s: STYLE_DATA_NUMBER,
    };
  }

  if (format === "percent") {
    const n = typeof value === "number" ? value : Number(value);
    // Nếu value đã là % (vd 25 nghĩa là 25%), divide by 100 cho Excel %
    return {
      v: Number.isFinite(n) ? n / 100 : 0,
      t: "n",
      z: "0.0%",
      s: STYLE_DATA_NUMBER,
    };
  }

  if (format === "date") {
    return { v: String(value), t: "s", s: STYLE_DATA_CENTER };
  }

  // Default text
  const align = col.align ?? "left";
  const style =
    align === "center"
      ? STYLE_DATA_CENTER
      : align === "right"
        ? STYLE_DATA_NUMBER
        : STYLE_DATA_TEXT;
  return { v: String(value), t: "s", s: style };
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
  /** Tenant name (vd "Cà Phê OneBiz") cho title row */
  tenantName?: string;
  /** Sheets to export — caller cung cấp */
  sheets: ExcelSheet[];
}

/**
 * Generate Excel file và download.
 */
export function exportReportToExcel(options: ExportOptions): void {
  const wb = XLSX.utils.book_new();

  // Workbook properties — hiển thị trong File Info
  wb.Props = {
    Title: `Báo cáo ${options.kind}`,
    Subject: `Báo cáo phân tích ${options.kind} — ${options.range.from} đến ${options.range.to}`,
    Author: options.tenantName ?? "OneBiz ERP",
    Company: options.tenantName ?? "OneBiz",
    CreatedDate: new Date(),
  };

  for (const sheet of options.sheets) {
    const ws = buildWorksheet(sheet);
    const safeName = sheet.name
      .replace(/[\\/:*?[\]]/g, "")
      .substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  const filename = buildFilename(options);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, filename);
}

function buildFilename(options: ExportOptions): string {
  // CEO 14/05: pattern chuẩn `OneBiz_<Module>_<ChiNhanh>_<YYYYMM>_<exportDate>.xlsx`
  // (research từ KiotViet/MISA — tên file phải tự explain được module + kỳ + chi nhánh)
  const { kind, range, branchName } = options;
  const branchSafe = (branchName ?? "TatCa")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip Vietnamese diacritics
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 20);
  // Kỳ báo cáo: YYYYMM (nếu từ-đến cùng tháng) hoặc YYYYMMDD-YYYYMMDD
  const fromShort = range.from.replace(/-/g, "");
  const toShort = range.to.replace(/-/g, "");
  const period =
    fromShort.slice(0, 6) === toShort.slice(0, 6)
      ? fromShort.slice(0, 6)
      : `${fromShort}-${toShort}`;
  const today = new Date();
  const exportDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  return `OneBiz_${kind}_${branchSafe}_${period}_${exportDate}.xlsx`;
}

// ============================================================
// Helper: build "Sheet 0 — Thông tin báo cáo" (chuẩn MISA/KiotViet)
// ============================================================

export interface InfoSheetOptions {
  /** Title chính (vd "BÁO CÁO BÁN HÀNG") */
  title: string;
  /** Subtitle/mô tả ngắn (vd "Tổng hợp doanh thu theo các chiều phân tích") */
  description?: string;
  range: DateRange;
  branchName?: string;
  tenantName?: string;
  generatedAt?: Date;
  generatedBy?: string;
  /** Disclaimer (vd "Báo cáo quản trị — không thay thế BCTC theo TT200/133") */
  disclaimer?: string;
  /** Hướng dẫn đọc báo cáo (optional) — bullet list */
  guide?: string[];
}

/**
 * Tạo Sheet "Thông tin" — đặt làm sheet đầu tiên trong workbook để user
 * biết file là gì, kỳ nào, chi nhánh nào, do ai xuất, có disclaimer gì.
 */
export function buildInfoSheet(opts: InfoSheetOptions): ExcelSheet {
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const at = opts.generatedAt ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtDateTime = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;

  const rows: Record<string, unknown>[] = [
    { label: "Doanh nghiệp", value: opts.tenantName ?? "OneBiz" },
    { label: "Báo cáo", value: opts.title },
  ];
  if (opts.description) {
    rows.push({ label: "Mô tả", value: opts.description });
  }
  rows.push(
    {
      label: "Kỳ báo cáo",
      value: `${fmtDate(opts.range.from)} → ${fmtDate(opts.range.to)}`,
    },
    { label: "Chi nhánh", value: opts.branchName ?? "Tất cả chi nhánh" },
    { label: "Ngày xuất", value: fmtDateTime },
  );
  if (opts.generatedBy) {
    rows.push({ label: "Người xuất", value: opts.generatedBy });
  }
  if (opts.disclaimer) {
    rows.push({ label: "Lưu ý", value: opts.disclaimer });
  }
  if (opts.guide && opts.guide.length > 0) {
    rows.push({ label: "Hướng dẫn", value: opts.guide.join("\n• ") });
  }

  return {
    name: "Thông tin",
    titleRows: [opts.title],
    columns: [
      { label: "Thông tin", key: "label", width: 22 },
      { label: "Nội dung", key: "value", width: 60 },
    ],
    rows,
  };
}

// ============================================================
// Helpers — title rows builder
// ============================================================

export function buildReportTitleRows(args: {
  title: string;
  range: DateRange;
  branchName?: string;
  tenantName?: string;
  generatedAt?: Date;
  generatedBy?: string;
}): string[] {
  const fmtRange = (() => {
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split("-");
      return `${d}/${m}/${y}`;
    };
    return `Từ ngày ${fmt(args.range.from)} đến ngày ${fmt(args.range.to)}`;
  })();

  const rows = [args.title]; // Row 0: title chính
  if (args.tenantName) {
    rows.push(args.tenantName);
  }
  rows.push(fmtRange);
  if (args.branchName) {
    rows.push(`Chi nhánh: ${args.branchName}`);
  }
  const at = args.generatedAt ?? new Date();
  const fmtDateTime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  rows.push(
    args.generatedBy
      ? `Lập ngày ${fmtDateTime(at)} — Người lập: ${args.generatedBy}`
      : `Lập ngày ${fmtDateTime(at)}`,
  );
  return rows;
}
