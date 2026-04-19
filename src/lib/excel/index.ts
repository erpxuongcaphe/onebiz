/**
 * Excel Import/Export — Public API
 *
 * Dùng:
 *  import { downloadTemplate, exportToExcelFromSchema, parseExcelFile } from "@/lib/excel";
 *  import type { ExcelSchema, ExcelColumn, ParseResult } from "@/lib/excel";
 */

export type {
  ColumnType,
  ExcelColumn,
  ExcelSchema,
  ImportBatchResult,
  ParsedRow,
  ParseResult,
} from "./types";

export { downloadTemplate, exportToExcelFromSchema } from "./template-builder";
export { parseExcelFile, parseWorkbook } from "./template-parser";
