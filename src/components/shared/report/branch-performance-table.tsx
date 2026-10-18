"use client";

import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import { managementReportLink } from "@/lib/reports/management-review";
import { BRANCH_FIELDS, BRANCH_METRICS, BRANCH_STATUS_LABELS, EMPTY_BRANCH_FILTER, branchPerformanceTotals, type BranchPerformanceFilter, type BranchPerformanceRow } from "@/lib/reports/branch-performance";
import { MetricFilters } from "./metric-filters";
import { ReportDataTable, type DataTableColumn } from "./report-data-table";

export function BranchPerformanceTable({ rows, types, filter, onFilter, sort, onSort, range }: {
  rows: BranchPerformanceRow[]; types: { value: string; label: string }[];
  filter: BranchPerformanceFilter; onFilter: (value: BranchPerformanceFilter) => void;
  sort: { id: string; direction: "asc" | "desc" }; onSort: (value: { id: string; direction: "asc" | "desc" }) => void;
  range: { from: string; to: string };
}) {
  const totals = branchPerformanceTotals(rows);
  const numeric = (key: string, value: unknown) => value === null ? "—" : ["grossMargin", "netMargin", "revenueShare", "missingCostLines", "previousMissingCostLines"].includes(key) ? formatStockQuantity(Number(value)) : formatCurrency(Number(value));
  const columns: DataTableColumn<BranchPerformanceRow>[] = BRANCH_FIELDS.map((field, index) => ({ ...field,
    sticky: index === 0, hideable: index !== 0, width: index === 0 ? "250px" : "180px", align: index < 2 ? "left" : "right",
    // Scope is initialized on mount; same-route soft navigation would retain the old branch.
    cell: row => index === 0 ? <a className="inline-flex min-h-9 items-center gap-1 text-primary" href={managementReportLink("/phan-tich/bao-cao-tai-chinh", row.branchId, range)}>{row.branchName}<Icon name="arrow_forward" size={16} /></a> : index === 1 ? row.typeLabel : numeric(field.key, row[field.key as keyof BranchPerformanceRow]),
    subtotalCell: index > 1 ? numeric(field.key, totals[field.key as keyof typeof totals]) : undefined,
  }));
  return <div className="space-y-3">
    <div className="grid gap-2 sm:grid-cols-3">
      <Input aria-label="Tìm chi nhánh trong báo cáo" placeholder="Tên chi nhánh" value={filter.search} onChange={event => onFilter({ ...filter, search: event.target.value })} />
      <select aria-label="Loại chi nhánh trong báo cáo" className="h-10 rounded border bg-background px-2 text-sm" value={filter.type} onChange={event => onFilter({ ...filter, type: event.target.value })}><option value="">Tất cả loại chi nhánh</option>{types.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
      <select aria-label="Kết quả chi nhánh" className="h-10 rounded border bg-background px-2 text-sm" value={filter.status} onChange={event => onFilter({ ...filter, status: event.target.value as BranchPerformanceFilter["status"] })}>{Object.entries(BRANCH_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </div>
    <MetricFilters fields={BRANCH_METRICS} value={filter.metrics} onChange={metrics => onFilter({ ...filter, metrics })} />
    {(filter.search || filter.type || filter.status !== "all" || filter.metrics.length > 0) && <button type="button" className="min-h-9 text-sm text-primary" onClick={() => onFilter(EMPTY_BRANCH_FILTER)}>Xóa bộ lọc chi nhánh</button>}
    <ReportDataTable rows={rows} columns={columns} getRowKey={row => row.branchId} sortState={sort} onSortChange={onSort} tablePreferenceKey="report.financial-results.branches" subtotalLabel={`${rows.length} chi nhánh`} emptyState="Không có chi nhánh phù hợp." />
    <p className="text-xs leading-5 text-muted-foreground">Tổng bảng theo bộ lọc, gồm nội bộ; không phải tổng hợp nhất. Tỷ trọng trên doanh thu tất cả chi nhánh trong phạm vi. Chưa đủ giá vốn không tính là 0.</p>
  </div>;
}
