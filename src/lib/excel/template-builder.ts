/**
 * Excel Template Builder
 *
 * 2 mục đích:
 *  1. downloadTemplate(schema) → tải file mẫu rỗng cho user điền
 *  2. exportToExcelFromSchema(rows, schema) → xuất dữ liệu hiện có
 *
 * CỰC KỲ QUAN TRỌNG: cả 2 function dùng CÙNG schema → user edit file export
 * rồi upload lại không bị mất column nào (yêu cầu 1+2 của plan).
 *
 * Sheet layout:
 *  - "Dữ liệu"  : header row (hàng 1) + data/example rows (hàng 2+)
 *  - "Hướng dẫn": mô tả từng cột, bắt buộc, format, enum values
 */

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import type { ExcelSchema } from "./types";

const DATA_SHEET = "Dữ liệu";
const GUIDE_SHEET = "Hướng dẫn";

/** Format 1 giá trị để hiển thị trong cell template/export. */
function formatValueForCell<TRow>(
  value: unknown,
  column: ExcelSchema<TRow>["columns"][number]
): string | number | boolean | null {
  if (value === undefined || value === null || value === "") return null;

  // Custom format override
  if (column.format) {
    const formatted = column.format(value);
    return formatted as string | number | null;
  }

  // enum: resolve label nếu có
  if (column.type === "enum" && column.enumLabels) {
    const str = String(value);
    return column.enumLabels[str] ?? str;
  }

  // date: format DD/MM/YYYY HH:mm to match the app-wide date convention.
  if (column.type === "date") {
    if (value instanceof Date) {
      return formatDate(value);
    }
    if (typeof value === "string") {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return formatDate(d);
      return value;
    }
  }

  // boolean: "Có" / "Không" thay vì TRUE/FALSE cho user tiếng Việt
  if (column.type === "boolean") {
    return value ? "Có" : "Không";
  }

  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dd = pad(d.getDate());
  const m = pad(d.getMonth() + 1);
  const y = d.getFullYear();
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${dd}/${m}/${y} ${h}:${mi}`;
}

function buildDataSheet<TRow>(
  schema: ExcelSchema<TRow>,
  rows: TRow[]
): XLSX.WorkSheet {
  const headers = schema.columns.map((c) => c.header);
  const dataRows = rows.map((row) =>
    schema.columns.map((c) => {
      const raw = (row as Record<string, unknown>)[c.key];
      return formatValueForCell(raw, c);
    })
  );

  const aoa: (string | number | boolean | null)[][] = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws["!cols"] = schema.columns.map((c) => ({ wch: c.width ?? 18 }));

  // Freeze header row (hàng 1 luôn hiện khi scroll xuống)
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  // SheetJS community không hỗ trợ freeze trực tiếp qua property, nhưng
  // "!freeze" là convention của một số tool — giữ để doc.
  // Thực tế freeze dùng via Views object:
  if (!ws["!views"]) ws["!views"] = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

  return ws;
}

function buildGuideSheet<TRow>(schema: ExcelSchema<TRow>): XLSX.WorkSheet {
  // ============================================================
  // Sprint EXCEL-GUIDE (CEO 06/05/2026) — sheet hướng dẫn nhập liệu
  // đầy đủ cho kế toán không phải dev:
  //   1. Tiêu đề file + mô tả mục đích
  //   2. Quy tắc nhập liệu chung (5 quy tắc cơ bản)
  //   3. Bảng metadata cột (tên / bắt buộc / kiểu / ghi chú / ví dụ)
  //   4. Lỗi thường gặp + cách xử lý
  //   5. Hỗ trợ (nơi liên hệ khi gặp khó)
  // ============================================================

  const rows: (string | number | null)[][] = [];

  // ========================================
  // Section 1: Tiêu đề + mô tả
  // ========================================
  rows.push([
    `📖 HƯỚNG DẪN NHẬP LIỆU — ${schema.fileName.toUpperCase()}`,
    "",
    "",
    "",
    "",
  ]);
  rows.push(["", "", "", "", ""]);
  if (schema.description) {
    rows.push(["Mục đích:", schema.description, "", "", ""]);
    rows.push(["", "", "", "", ""]);
  }

  // ========================================
  // Section 2: Quy tắc nhập liệu chung
  // ========================================
  rows.push(["📌 QUY TẮC NHẬP LIỆU CHUNG", "", "", "", ""]);
  rows.push(["", "", "", "", ""]);
  rows.push([
    "1.",
    "Chỉ nhập dữ liệu vào sheet 'Dữ liệu', KHÔNG sửa sheet này",
    "",
    "",
    "",
  ]);
  rows.push([
    "2.",
    "Hàng 1 trong sheet 'Dữ liệu' là tiêu đề cột — KHÔNG xoá hoặc đổi thứ tự",
    "",
    "",
    "",
  ]);
  rows.push([
    "3.",
    "Bắt đầu nhập từ hàng 2. Mỗi hàng = 1 dòng dữ liệu",
    "",
    "",
    "",
  ]);
  rows.push([
    "4.",
    "Cột đánh dấu 'Có' ở 'Bắt buộc' không được để trống",
    "",
    "",
    "",
  ]);
  rows.push([
    "5.",
    "Định dạng số tiền: chỉ nhập số nguyên (vd 25000), KHÔNG nhập 'đ', dấu phẩy, dấu chấm",
    "",
    "",
    "",
  ]);
  rows.push([
    "6.",
    "Định dạng ngày: DD/MM/YYYY (vd 06/05/2026)",
    "",
    "",
    "",
  ]);
  rows.push([
    "7.",
    "Cột chọn 1 (enum): copy chính xác giá trị từ cột 'Giá trị hợp lệ' bên dưới",
    "",
    "",
    "",
  ]);
  rows.push(["", "", "", "", ""]);

  // ========================================
  // Section 3: Bảng metadata cột
  // ========================================
  rows.push(["📋 CHI TIẾT TỪNG CỘT", "", "", "", ""]);
  rows.push(["", "", "", "", ""]);
  const header = [
    "Tên cột",
    "Bắt buộc",
    "Kiểu dữ liệu",
    "Giá trị hợp lệ / Ghi chú",
    "Ví dụ",
  ];
  rows.push(header);

  for (const col of schema.columns) {
    const notes: string[] = [];
    if (col.description) notes.push(col.description);
    if (col.enumValues && col.enumValues.length > 0) {
      const labels = col.enumLabels
        ? col.enumValues.map((v) => col.enumLabels?.[v] ?? v).join(" | ")
        : col.enumValues.join(" | ");
      notes.push(`Chọn 1 trong: ${labels}`);
    }
    if (col.min !== undefined || col.max !== undefined) {
      notes.push(
        `Giá trị: ${col.min ?? "-∞"} → ${col.max ?? "+∞"}`
      );
    }
    if (col.minLength !== undefined || col.maxLength !== undefined) {
      notes.push(
        `Độ dài: ${col.minLength ?? 0} → ${col.maxLength ?? "không giới hạn"}`
      );
    }
    if (col.pattern && col.patternMessage) {
      notes.push(col.patternMessage);
    }
    if (col.unique) notes.push("Không được trùng trong file");

    rows.push([
      col.header,
      col.required ? "Có" : "Không",
      typeLabel(col.type),
      notes.join(" · ") || "",
      col.example !== undefined ? String(col.example) : "",
    ]);
  }
  rows.push(["", "", "", "", ""]);

  // ========================================
  // Section 4: Lỗi thường gặp
  // ========================================
  rows.push(["⚠️ LỖI THƯỜNG GẶP", "", "", "", ""]);
  rows.push(["", "", "", "", ""]);
  rows.push(["Lỗi", "Nguyên nhân", "Cách xử lý", "", ""]);
  rows.push([
    "Cột bắt buộc bị trống",
    "Để trống cell ở cột có 'Bắt buộc = Có'",
    "Điền giá trị cho mọi hàng có dữ liệu — kể cả nếu một số cột khác trống",
    "",
    "",
  ]);
  rows.push([
    "Sai định dạng ngày",
    "Nhập '5/6/2026' hoặc '5-6-26' không chuẩn",
    "Đổi sang định dạng DD/MM/YYYY (vd 06/05/2026)",
    "",
    "",
  ]);
  rows.push([
    "Số tiền có dấu phẩy / chấm",
    "Excel tự thêm '1,000,000' khi định dạng cell là currency",
    "Đổi cell format sang Number không có separator (Format Cells → Number → 0 decimal)",
    "",
    "",
  ]);
  rows.push([
    "Mã trùng lặp",
    "Hai hàng có cùng mã sản phẩm / mã khách / mã NCC",
    "Kiểm tra cột đánh dấu 'Không được trùng trong file' và sửa giá trị duy nhất",
    "",
    "",
  ]);
  rows.push([
    "Giá trị enum không khớp",
    "Cột chọn 1 nhập sai chính tả (vd 'Cá nhân' thay vì 'CA_NHAN')",
    "Copy chính xác giá trị từ cột 'Giá trị hợp lệ' ở bảng trên",
    "",
    "",
  ]);
  rows.push([
    "Excel báo 'Lỗi đọc file'",
    "File có macro / link external bị block",
    "Mở Excel → File → Save As → chọn định dạng .xlsx (Excel Workbook), KHÔNG chọn .xlsm",
    "",
    "",
  ]);
  rows.push([
    "Tiếng Việt bị lỗi font",
    "Lưu sai encoding (CSV ANSI thay vì UTF-8)",
    "Luôn dùng định dạng .xlsx, KHÔNG dùng .csv",
    "",
    "",
  ]);
  rows.push(["", "", "", "", ""]);

  // ========================================
  // Section 5: Hỗ trợ
  // ========================================
  rows.push(["💬 HỖ TRỢ", "", "", "", ""]);
  rows.push(["", "", "", "", ""]);
  rows.push([
    "Khi gặp khó:",
    "Liên hệ admin qua chat trong web hoặc gọi quản lý hệ thống",
    "",
    "",
    "",
  ]);
  rows.push([
    "Tài liệu chi tiết:",
    "Vào Trang chủ → Hệ thống → Hướng dẫn sử dụng",
    "",
    "",
    "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 26 },
    { wch: 12 },
    { wch: 16 },
    { wch: 60 },
    { wch: 26 },
  ];

  // Merge title cell across columns
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, // Title
  ];

  return ws;
}

function typeLabel(type: string): string {
  switch (type) {
    case "string":
      return "Chữ";
    case "number":
      return "Số";
    case "integer":
      return "Số nguyên";
    case "boolean":
      return "Có / Không";
    case "date":
      return "Ngày (DD/MM/YYYY)";
    case "enum":
      return "Chọn 1";
    default:
      return type;
  }
}

function makeWorkbook<TRow>(
  schema: ExcelSchema<TRow>,
  rows: TRow[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const data = buildDataSheet(schema, rows);
  const guide = buildGuideSheet(schema);
  XLSX.utils.book_append_sheet(wb, data, DATA_SHEET);
  XLSX.utils.book_append_sheet(wb, guide, GUIDE_SHEET);
  return wb;
}

function saveWorkbook(wb: XLSX.WorkBook, baseName: string): void {
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const stamp = new Date().toISOString().slice(0, 10);
  saveAs(blob, `${baseName}-${stamp}.xlsx`);
}

/**
 * Tải file mẫu (empty + 1 row ví dụ nếu schema có `example`).
 * User mở file, thấy hàng 1 là header, hàng 2 là ví dụ, điền tiếp từ hàng 3.
 */
export function downloadTemplate<TRow>(schema: ExcelSchema<TRow>): void {
  // Build row ví dụ từ field .example của từng column
  const hasAnyExample = schema.columns.some((c) => c.example !== undefined);
  const exampleRow = hasAnyExample
    ? ({
        ...Object.fromEntries(
          schema.columns.map((c) => [c.key, c.example ?? null])
        ),
      } as TRow)
    : null;

  const rows = exampleRow ? [exampleRow] : [];
  const wb = makeWorkbook(schema, rows);
  saveWorkbook(wb, `${schema.fileName}-Mau`);
}

/**
 * Xuất dữ liệu hiện có ra file Excel, dùng CÙNG schema với template.
 * → User có thể tải → edit → upload lại mà không mất column nào.
 */
export function exportToExcelFromSchema<TRow>(
  rows: TRow[],
  schema: ExcelSchema<TRow>
): void {
  const wb = makeWorkbook(schema, rows);
  saveWorkbook(wb, schema.fileName);
}
