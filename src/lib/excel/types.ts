/**
 * Excel Import/Export — Type definitions
 *
 * Schema-driven approach: mỗi module khai báo 1 ExcelSchema → auto generate
 * template (file mẫu có sẵn header + row ví dụ), parse upload có validate,
 * preview grid highlight lỗi, insert batch.
 *
 * Nguyên tắc 4 yêu cầu (plan 19/04):
 *  1. File mẫu + Export dùng CÙNG schema → import lại không mất field
 *  2. Validate đủ cột/kiểu/required/unique/enum/min-max/pattern
 *  3. Báo lỗi từng dòng rõ ràng (tiếng Việt)
 *  4. Preview + xác nhận trước khi commit vào DB
 */

export type ColumnType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "enum";

export interface ExcelColumn<TRow = Record<string, unknown>> {
  /** Key trong row object (sau khi parse) */
  key: keyof TRow & string;
  /** Header hiển thị trong Excel (tiếng Việt có dấu) */
  header: string;
  type: ColumnType;
  required?: boolean;
  /** Check trùng giá trị trong cùng 1 file (VD mã SP, SĐT KH) */
  unique?: boolean;
  /** Giá trị enum (cho type='enum') — dropdown data validation */
  enumValues?: readonly string[];
  /** Mapping raw → label cho user (chỉ dùng khi export) */
  enumLabels?: Record<string, string>;
  /** Row ví dụ trong template — user dựa vào đây để biết format */
  example?: string | number | boolean;
  /** Độ rộng cột trong Excel, mặc định 18 */
  width?: number;
  /** Format giá trị khi export (VD currency) */
  format?: (value: unknown) => string | number | null;
  /**
   * Custom parser — nếu cung cấp, override kiểu mặc định.
   * Throw Error với message tiếng Việt khi invalid.
   */
  parse?: (raw: unknown, partialRow: Partial<TRow>) => unknown;
  /** Min/max cho number/integer */
  min?: number;
  max?: number;
  /** Min/max length cho string */
  minLength?: number;
  maxLength?: number;
  /** Regex validate cho string */
  pattern?: RegExp;
  patternMessage?: string;
  /** Description hiển thị trong sheet "Hướng dẫn" */
  description?: string;
}

export interface ExcelSchema<TRow = Record<string, unknown>> {
  /** Tên module hiển thị (VD: "Sản phẩm", "Khách hàng") */
  name: string;
  /** Prefix cho tên file xuất (KHÔNG kèm .xlsx, không kèm date) */
  fileName: string;
  columns: ExcelColumn<TRow>[];
  /**
   * Validate cross-column hoặc cross-row sau khi parse xong.
   * Trả null = OK, trả string = message lỗi tiếng Việt.
   */
  validateRow?: (row: TRow, index: number, allRows: TRow[]) => string | null;
  /** Description chung hiển thị ở đầu sheet "Hướng dẫn" */
  description?: string;
}

export interface ParsedRow<TRow> {
  /** Số dòng trong Excel (1-indexed, bao gồm header ở dòng 1) */
  rowIndex: number;
  data: Partial<TRow>;
  errors: string[];
}

export interface ParseResult<TRow> {
  validRows: TRow[];
  errorRows: ParsedRow<TRow>[];
  /** Tổng số dòng dữ liệu (không tính header, không tính row trống) */
  totalRows: number;
  /** Lỗi cấp bảng (VD thiếu cột required, file không có sheet) */
  tableErrors: string[];
}

export interface ImportBatchResult {
  successCount: number;
  failureCount: number;
  errors: Array<{ rowIndex: number; message: string }>;
}
