"use client";

import type { DataTableColumn } from "./report-data-table";
import { reportUnitLabel, type StockReportUnits } from "@/lib/reports/stock-unit-context";

export function stockUnitColumns<T extends Partial<StockReportUnits>>(options?: { unitLabel?: string; countLabel?: string; hideCount?: boolean }): DataTableColumn<T>[] {
  return [
    { key: "recordedUnit", label: options?.unitLabel || "ĐVT ghi sổ", width: "180px", cell: row => <div className="space-y-1"><span className={row.recordedUnit ? "" : "text-status-warning"}>{reportUnitLabel(row)}</span>{row.recordedConversion && <span className="block text-xs">Trên phiếu: {row.recordedConversion}</span>}<span className="block text-xs text-muted-foreground">Danh mục: {row.catalogUnit || "Chưa có ĐVT"}</span></div> },
    { key: "currentConversion", label: "Quy cách hiện tại", width: "220px", cell: row => <span className="block whitespace-normal break-words">{row.currentConversion || "Chưa có quy đổi phụ"}</span> },
    ...(options?.hideCount ? [] : [{ key: "recordedCount", label: options?.countLabel || "Thực kiểm theo ĐVT nhập", width: "200px", cell: (row: T) => row.recordedCount || "Chưa lưu" }]),
  ];
}

export const STOCK_UNIT_EXCEL_COLUMNS = [
  { key: "recordedUnit", label: "ĐVT ghi sổ", width: 18 },
  { key: "recordedConversion", label: "Quy đổi trên phiếu", width: 36 },
  { key: "catalogUnit", label: "ĐVT danh mục hiện tại", width: 22 },
  { key: "currentConversion", label: "Quy cách hiện tại", width: 42 },
  { key: "recordedCount", label: "Thực kiểm theo ĐVT nhập", width: 30 },
];
