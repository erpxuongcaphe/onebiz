/**
 * Excel Import/Export — Public API
 *
 * Sprint POLISH-3.1: chuyển sang **lazy load** xlsx.
 *
 * Trước đây các file `template-builder.ts` + `template-parser.ts` import
 * `xlsx` ở top-level → mọi list page (~16 file) đụng tới một trong các
 * helper này đều phải bundle xlsx (~400KB) vào initial JS dù user chưa
 * bao giờ bấm Import/Export. Giờ thì:
 *
 *   - Hàm dynamic-load `template-builder.ts` / `template-parser.ts` qua
 *     `await import(...)` chỉ khi function thực sự được gọi.
 *   - Caller phải `await downloadTemplate(...)`. Trang list mở lần đầu
 *     KHÔNG còn bị bundle xlsx.
 *
 * Type-only re-exports KHÔNG bundle code (TS strip type-only imports).
 *
 * ```ts
 * import { downloadTemplate, exportToExcelFromSchema, parseExcelFile } from "@/lib/excel";
 * import type { ExcelSchema, ExcelColumn, ParseResult } from "@/lib/excel";
 * ```
 */

import type { ExcelSchema, ParseResult } from "./types";

export type {
  ColumnType,
  ExcelColumn,
  ExcelSchema,
  ImportBatchResult,
  ParsedRow,
  ParseResult,
} from "./types";

export async function downloadTemplate<TRow>(
  schema: ExcelSchema<TRow>,
): Promise<void> {
  const mod = await import("./template-builder");
  return mod.downloadTemplate(schema);
}

export async function exportToExcelFromSchema<TRow>(
  rows: TRow[],
  schema: ExcelSchema<TRow>,
): Promise<void> {
  const mod = await import("./template-builder");
  return mod.exportToExcelFromSchema(rows, schema);
}

export async function parseExcelFile<TRow>(
  file: File,
  schema: ExcelSchema<TRow>,
): Promise<ParseResult<TRow>> {
  const mod = await import("./template-parser");
  return mod.parseExcelFile(file, schema);
}

// Note: `parseWorkbook` (sync, takes XLSX.WorkBook) requires importing the
// xlsx type — eager-bundle defeats the lazy goal. Test code imports it
// directly from "./template-parser" instead.
