/**
 * Excel Template Parser
 *
 * Parse file .xlsx / .xls / .csv người dùng upload, validate theo schema,
 * return ParseResult để preview trước khi commit.
 *
 * Nguyên tắc:
 *  - Match column theo HEADER NAME (không theo thứ tự). User có thể rearrange
 *    columns trong file, miễn tên header không đổi.
 *  - Bỏ qua row trống (tất cả cell null/undefined/"").
 *  - Mỗi row có errors → đẩy vào errorRows, không block các row khác.
 *  - Table-level errors (thiếu cột required, sheet sai) → tableErrors.
 *  - Tất cả message lỗi tiếng Việt có dấu.
 */

import * as XLSX from "xlsx";
import type {
  ExcelColumn,
  ExcelSchema,
  ParsedRow,
  ParseResult,
} from "./types";
import { parseDateInput, parseNumberInput } from "@/lib/format";

/** Entry point: parse file upload → ParseResult */
export async function parseExcelFile<TRow>(
  file: File,
  schema: ExcelSchema<TRow>
): Promise<ParseResult<TRow>> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  return parseWorkbook<TRow>(wb, schema);
}

/** Parse workbook object. Public để unit test. */
export function parseWorkbook<TRow>(
  wb: XLSX.WorkBook,
  schema: ExcelSchema<TRow>
): ParseResult<TRow> {
  const tableErrors: string[] = [];

  // Opening stock accepts visually equivalent headers without changing data values.
  const headerKey = (value: unknown): string => {
    const text = value == null ? "" : String(value);
    return schema.normalizeHeaders
      ? text.normalize("NFC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN")
      : text.trim();
  };
  const sheetName =
    wb.SheetNames.find((name) => headerKey(name) === headerKey("Dữ liệu")) ?? wb.SheetNames[0];

  if (!sheetName) {
    return {
      validRows: [],
      errorRows: [],
      totalRows: 0,
      tableErrors: ["File Excel không có sheet nào"],
    };
  }

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      validRows: [],
      errorRows: [],
      totalRows: 0,
      tableErrors: [`Không tìm thấy sheet "${sheetName}" trong file`],
    };
  }

  // Đọc toàn bộ sheet thành array of arrays (giữ empty cells)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    blankrows: schema.headerRowSearchLimit ? true : false,
    raw: true,
  });

  if (aoa.length === 0) {
    tableErrors.push("File rỗng, không có dữ liệu");
    return { validRows: [], errorRows: [], totalRows: 0, tableErrors };
  }

  let headerIndex = 0;
  const searchLimit = Math.min(aoa.length, Math.max(1, schema.headerRowSearchLimit ?? 1));
  const requiredHeaders = schema.columns.filter(column => column.required).map(column => headerKey(column.header));
  let bestScore = -1;
  for (let index = 0; index < searchLimit; index++) {
    const keys = new Set((aoa[index] ?? []).map(headerKey));
    const score = schema.columns.filter((column) => keys.has(headerKey(column.header))).length;
    if (score > bestScore) { bestScore = score; headerIndex = index; }
    // Stop at the first complete required header; never skip data for a later header.
    if (requiredHeaders.length > 0 && requiredHeaders.every(header => keys.has(header))) {
      headerIndex = index; break;
    }
  }
  const headerRow = (aoa[headerIndex] ?? []).map(headerKey);

  // Map từ column.key → index trong file
  const keyToIndex = new Map<string, number>();
  for (const column of schema.columns) {
    const matches = headerRow.flatMap((header, index) =>
      header === headerKey(column.header) ? [index] : []);
    if (schema.normalizeHeaders && matches.length > 1) {
      tableErrors.push(`Cột "${column.header}" bị lặp ở dòng tiêu đề ${headerIndex + 1}. Xóa hoặc đổi tên cột trùng trước khi nhập.`);
      continue;
    }
    const idx = matches[0] ?? -1;
    if (idx === -1) {
      if (column.required) {
        tableErrors.push(
          `Thiếu cột bắt buộc "${column.header}" (cột không có trong file)`
        );
      }
      // optional cột vẫn parse tiếp, chỉ bỏ qua field đó
    } else {
      keyToIndex.set(column.key, idx);
    }
  }

  // Nếu có table error nghiêm trọng, vẫn parse để show lỗi từng dòng
  // nhưng return với tableErrors đầy đủ.

  if (schema.normalizeHeaders && tableErrors.length > 0) {
    tableErrors.push(`Đang đọc sheet "${sheetName}", tiêu đề dòng ${headerIndex + 1}. Các cột đọc được: ${(aoa[headerIndex] ?? []).filter((cell) => cell != null && String(cell).trim()).join(" · ")}.`);
  }

  const parsedRows: ParsedRow<TRow>[] = [];
  for (let i = headerIndex + 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    if (isRowEmpty(row)) continue;

    const rowIndex = i + 1; // 1-indexed như Excel hiển thị
    const parsed = parseSingleRow<TRow>(row, rowIndex, schema, keyToIndex);
    parsedRows.push(parsed);
  }

  // Unique check trong cùng file
  applyUniqueConstraints(parsedRows, schema);

  // Validate cross-column/cross-row qua schema.validateRow nếu có
  if (schema.validateRow) {
    const validSoFar: TRow[] = parsedRows
      .filter((p) => p.errors.length === 0)
      .map((p) => p.data as TRow);

    for (const pr of parsedRows) {
      if (pr.errors.length > 0) continue;
      try {
        const msg = schema.validateRow(
          pr.data as TRow,
          pr.rowIndex,
          validSoFar
        );
        if (msg) pr.errors.push(msg);
      } catch (err) {
        pr.errors.push(
          err instanceof Error
            ? err.message
            : "Lỗi validate không xác định"
        );
      }
    }
  }

  const validRows = parsedRows
    .filter((p) => p.errors.length === 0)
    .map((p) => p.data as TRow);
  const errorRows = parsedRows.filter((p) => p.errors.length > 0);

  return {
    validRows,
    errorRows,
    totalRows: parsedRows.length,
    tableErrors,
  };
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every(
    (cell) => cell === null || cell === undefined || String(cell).trim() === ""
  );
}

function parseSingleRow<TRow>(
  row: unknown[],
  rowIndex: number,
  schema: ExcelSchema<TRow>,
  keyToIndex: Map<string, number>
): ParsedRow<TRow> {
  const data: Partial<TRow> = {};
  const errors: string[] = [];

  for (const column of schema.columns) {
    const idx = keyToIndex.get(column.key);
    const raw = idx !== undefined ? row[idx] : undefined;

    // Required check
    if (isEmpty(raw)) {
      if (column.required) {
        errors.push(`Thiếu giá trị cho "${column.header}"`);
      }
      continue;
    }

    // Custom parse (override)
    if (column.parse) {
      try {
        const parsed = column.parse(raw, data);
        (data as Record<string, unknown>)[column.key] = parsed;
      } catch (err) {
        errors.push(
          `"${column.header}": ${
            err instanceof Error ? err.message : "giá trị không hợp lệ"
          }`
        );
      }
      continue;
    }

    // Default parsing theo type
    try {
      const parsed = parseByType(raw, column);
      validateValue(parsed, column);
      (data as Record<string, unknown>)[column.key] = parsed;
    } catch (err) {
      errors.push(
        `"${column.header}": ${
          err instanceof Error ? err.message : "giá trị không hợp lệ"
        }`
      );
    }
  }

  Object.defineProperty(data, "__excelRowIndex", {
    value: rowIndex,
    enumerable: false,
    configurable: false,
  });

  return { rowIndex, data, errors };
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

function parseByType<TRow>(raw: unknown, col: ExcelColumn<TRow>): unknown {
  const str = String(raw).trim();

  switch (col.type) {
    case "string":
      return str;

    case "number": {
      const n = typeof raw === "number" ? raw : parseNumberInput(str);
      if (n == null || Number.isNaN(n)) throw new Error("phải là số");
      return n;
    }

    case "integer": {
      const n = typeof raw === "number" ? raw : parseNumberInput(str);
      if (n == null || Number.isNaN(n) || !Number.isInteger(n)) {
        throw new Error("phải là số nguyên");
      }
      return n;
    }

    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const v = str.toLowerCase();
      if (["có", "co", "yes", "y", "true", "1", "x"].includes(v)) return true;
      if (["không", "khong", "no", "n", "false", "0", ""].includes(v)) {
        return false;
      }
      throw new Error("phải là Có hoặc Không");
    }

    case "date": {
      if (raw instanceof Date) return raw;
      if (typeof raw === "number") {
        // Excel serial date number → JS Date
        const d = excelSerialToDate(raw);
        if (!d) throw new Error("ngày không hợp lệ");
        return d;
      }
      const d = parseDateInput(str);
      if (!d) {
        throw new Error("ngày không hợp lệ (dạng DD/MM/YYYY)");
      }
      return d;
    }

    case "enum": {
      // Match cả raw value và label (nếu có enumLabels)
      if (!col.enumValues || col.enumValues.length === 0) return str;
      if (col.enumValues.includes(str)) return str;
      if (col.enumLabels) {
        for (const [v, label] of Object.entries(col.enumLabels)) {
          if (label === str) return v;
        }
      }
      throw new Error(
        `phải là 1 trong: ${col.enumValues.join(", ")}`
      );
    }

    default:
      return str;
  }
}

function validateValue<TRow>(value: unknown, col: ExcelColumn<TRow>): void {
  if (col.type === "number" || col.type === "integer") {
    const n = value as number;
    if (col.min !== undefined && n < col.min) {
      throw new Error(`không được nhỏ hơn ${col.min}`);
    }
    if (col.max !== undefined && n > col.max) {
      throw new Error(`không được lớn hơn ${col.max}`);
    }
  }

  if (col.type === "string") {
    const s = value as string;
    if (col.minLength !== undefined && s.length < col.minLength) {
      throw new Error(`phải có ít nhất ${col.minLength} ký tự`);
    }
    if (col.maxLength !== undefined && s.length > col.maxLength) {
      throw new Error(`không được quá ${col.maxLength} ký tự`);
    }
    if (col.pattern && !col.pattern.test(s)) {
      throw new Error(col.patternMessage ?? "sai định dạng");
    }
  }
}

/** Excel serial date → JS Date (base 1900, có bug năm nhuận 1900). */
function excelSerialToDate(n: number): Date | null {
  if (n < 1) return null;
  const utcDays = Math.floor(n - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = n - Math.floor(n) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;
  const hours = Math.floor(totalSeconds / (60 * 60));
  const minutes = Math.floor(totalSeconds / 60) % 60;
  return new Date(
    Date.UTC(
      dateInfo.getUTCFullYear(),
      dateInfo.getUTCMonth(),
      dateInfo.getUTCDate(),
      hours,
      minutes,
      seconds
    )
  );
}

function applyUniqueConstraints<TRow>(
  parsedRows: ParsedRow<TRow>[],
  schema: ExcelSchema<TRow>
): void {
  const uniqueCols = schema.columns.filter((c) => c.unique);
  if (uniqueCols.length === 0) return;

  for (const col of uniqueCols) {
    const seen = new Map<string, number[]>(); // value → rowIndex[]
    for (const pr of parsedRows) {
      const v = (pr.data as Record<string, unknown>)[col.key];
      if (v === undefined || v === null || v === "") continue;
      const key = String(v);
      const arr = seen.get(key) ?? [];
      arr.push(pr.rowIndex);
      seen.set(key, arr);
    }

    for (const [val, indices] of seen.entries()) {
      if (indices.length > 1) {
        const list = indices.join(", ");
        for (const pr of parsedRows) {
          if (indices.includes(pr.rowIndex)) {
            pr.errors.push(
              `"${col.header}" = "${val}" bị trùng ở các dòng: ${list}`
            );
          }
        }
      }
    }
  }
}
