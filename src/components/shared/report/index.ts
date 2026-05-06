/**
 * Report framework — barrel export.
 *
 * Sprint REP-1 (CEO 06/05/2026): build framework chuẩn cho 14 báo cáo phân tích
 * sau khi phát hiện date filter cũ KHÔNG re-fetch + thiếu Chart/Table toggle +
 * thiếu Excel export schema đầy đủ.
 */

export { ReportPageHeader } from "./report-page-header";
export { ReportDateRangePicker } from "./report-date-range-picker";
export { ChartTableSwitch } from "./chart-table-switch";
export { ReportDataTable } from "./report-data-table";
export type {
  DataTableColumn,
  ColumnGroup,
  DataTableProps,
  ColumnAlign,
} from "./report-data-table";
