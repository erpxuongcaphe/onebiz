"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportPageHeader, ReportDataTable, type DataTableColumn } from "@/components/shared/report";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
import { getDeliveryInvoiceManagement, type DeliveryInvoiceReport } from "@/lib/services/supabase/delivery-invoice-management";
import { deliveryInvoiceView, filterDeliveryRows, summarizeDeliveryRows, deliveryManagementColumns, deliverySortValue, sortDeliveryRows, type DeliveryInvoiceView, type DeliveryFilters } from "@/lib/reports/delivery-invoice-view";
import { sortedReportView } from "@/lib/reports/table-sort";
import { exportReportToExcel, buildReportTitleRows, type ExcelSheet } from "@/lib/utils/excel-export";
import { formatCurrency, formatNumber } from "@/lib/format";
import { LoadErrorState } from "@/components/shared/load-error-state";
import DeliveryReportFilters, { deliveryFilterDescriptions, deliveryOrderMetricFields, deliverySummaryMetricFields } from "./delivery-report-filters";
import { matchesMetricFilters, metricFilterError, type MetricFilter } from "@/lib/reports/metric-filter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/app/(main)/phan-tich/_components";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Sort = { id: string; direction: "asc" | "desc" } | null;
const EMPTY_FILTERS: DeliveryFilters = { search: "", staff: "", status: "", method: "" };
export default function DeliveryInvoiceManagementReport() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "today", defaultViewMode: "table" });
  const readScope = JSON.stringify([activeBranchId, range.from, range.to]);
  const currentScope = useRef(readScope);
  currentScope.current = readScope;
  const [report, setReport] = useState<DeliveryInvoiceReport | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS), [tab, setTab] = useState("staff");
  const [summaryMetrics, setSummaryMetrics] = useState<MetricFilter[]>([]);
  const [sort, setSort] = useState<Sort>(null), [summarySort, setSummarySort] = useState<Sort>(null);
  const [exporting, setExporting] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);
  const [download, setDownload] = useState<{ url: string; filename: string; revision: number; scope: string } | null>(null);
  const requestIdRef = useRef(0), exportRevision = useRef(0);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  const load = useCallback(async (resetFilters = true) => {
    const requestId = ++requestIdRef.current; exportRevision.current++;
    const scope = JSON.stringify([activeBranchId, range.from, range.to]);
    setLoading(true); setError(null); setReport(null); setLoadedScope(null); setSnapshotAt(null); setDownload(null); if (resetFilters) { setFilters(EMPTY_FILTERS); setSummaryMetrics([]); }
    try { const data = await getDeliveryInvoiceManagement(activeBranchId, range); if (requestId !== requestIdRef.current || scope !== currentScope.current) return; setReport(data); setLoadedScope(scope); setSnapshotAt(new Date()); }
    catch (err) { if (requestId === requestIdRef.current) setError(err instanceof Error ? err.message : "Không tải được giao hàng."); }
    finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [activeBranchId, range]);
  useEffect(() => { if (isReady) void load(); return () => { requestIdRef.current++; exportRevision.current++; }; }, [isReady, load]);
  const scopedReport = isReady && loadedScope === readScope ? report : null;
  const allRows = useMemo(() => deliveryInvoiceView(scopedReport?.items ?? []), [scopedReport]);
  const canViewMoney = scopedReport?.canViewMoney ?? false;
  const allowedOrderMetrics = deliveryOrderMetricFields(canViewMoney);
  const allowedSummaryMetrics = deliverySummaryMetricFields(canViewMoney);
  const permittedMetrics = summaryMetrics.filter(filter => allowedSummaryMetrics.some(field => field.key === filter.key));
  const permittedFilters = { ...filters, method: canViewMoney ? filters.method : "", metrics: filters.metrics?.filter(filter => allowedOrderMetrics.some(field => field.key === filter.key)) };
  const invalidFilters = (filters.metrics ?? []).some(filter => !deliveryOrderMetricFields(true).some(field => field.key === filter.key)) ||
    summaryMetrics.some(filter => !deliverySummaryMetricFields(true).some(field => field.key === filter.key)) ||
    metricFilterError(permittedFilters.metrics ?? []) || metricFilterError(permittedMetrics) ||
    (!!filters.assignedFrom && !!filters.assignedTo && filters.assignedFrom > filters.assignedTo) ||
    (!!filters.completedFrom && !!filters.completedTo && filters.completedFrom > filters.completedTo);
  const detailFiltered = filterDeliveryRows(allRows, permittedFilters);
  const summaryCandidates = (() => {
    const groups = new Map<string, DeliveryInvoiceView[]>();
    for (const row of detailFiltered) {
      const group = groups.get(row.staffKey);
      if (group) group.push(row); else groups.set(row.staffKey, [row]);
    }
    return [...groups.entries()].map(([id, group]) => ({ id, branchName: group[0].branchName, staffName: group[0].staffName, ...summarizeDeliveryRows(group) }));
  })();
  const summary = invalidFilters ? [] : summaryCandidates.filter(row => matchesMetricFilters(row, permittedMetrics));
  const includedStaff = new Set(summary.map(row => row.id));
  const filtered = detailFiltered.filter(row => includedStaff.has(row.staffKey));
  const rows = sortDeliveryRows(filtered, sort);
  const totals = summarizeDeliveryRows(filtered);
  const summaryRows = sortedReportView(summary, summarySort);
  const detailColumns = deliveryManagementColumns(canViewMoney);
  const summaryColumns: ExcelSheet["columns"] = [
    { label: "Chi nhánh", key: "branchName", width: 28 }, { label: "Nhân viên giao", key: "staffName", width: 25 },
    { label: "Số đơn", key: "orders", width: 12, format: "number" }, { label: "Đã giao", key: "completed", width: 12, format: "number" },
    { label: "Đã hủy", key: "cancelled", width: 12, format: "number" }, { label: "Chưa phân công", key: "unassigned", width: 18, format: "number" },
    { label: "Thời gian giao TB (giây)", key: "avgDeliverySeconds", width: 24, format: "number" },
    { label: "Đơn đủ mốc giao", key: "timedCount", width: 20, format: "number" },
    ...(canViewMoney ? [
      { label: "Giá trị HĐ xác định (VND)", key: "invoiceTotal", width: 26, format: "currency" as const },
      { label: "Đã thanh toán trên HĐ (VND)", key: "invoicePaid", width: 27, format: "currency" as const },
      { label: "Còn phải thu trên HĐ (VND)", key: "invoiceDebt", width: 27, format: "currency" as const },
      { label: "Phí giao trên đơn (VND)", key: "deliveryFee", width: 24, format: "currency" as const },
      { label: "Đơn cần kiểm tra HĐ", key: "missingInvoice", width: 24, format: "number" as const },
    ] : []),
  ];
  const toWebColumns = <T extends object,>(columns: ExcelSheet["columns"]): DataTableColumn<T>[] => columns.map(column => ({
    key: column.key, label: column.label, align: column.format === "currency" || column.format === "number" ? "right" : "left",
    cell: row => { const value = row[column.key as keyof T]; return value === null || value === undefined || value === "" ? "—" : column.format === "currency" ? formatCurrency(Number(value)) : column.format === "number" ? formatNumber(Number(value)) : String(value); },
  }));
  const exportFile = async (full: boolean) => {
    if (loading || error || exporting || invalidFilters || !rows.length || !scopedReport) return;
    const revision = exportRevision.current, scope = readScope; setExporting(true);
    const titleRows = buildReportTitleRows({ title: "Giao hàng theo nhân viên", range, branchName: branchLabel, generatedAt: new Date() });
    const descriptions = deliveryFilterDescriptions(permittedFilters, allRows, canViewMoney, permittedMetrics);
    titleRows.push(`Bộ lọc: ${descriptions.map(filter => `${filter.label}: ${filter.value}`).join("; ") || "Tất cả"}`);
    const sortLabel = (value: Sort, columns: ExcelSheet["columns"]) => value ? `${columns.find(column => column.key === value.id)?.label ?? value.id} (${value.direction === "asc" ? "tăng" : "giảm"})` : "Theo nguồn";
    titleRows.push(`Sắp xếp nhân viên: ${sortLabel(summarySort, summaryColumns)}; Sắp xếp đơn: ${sortLabel(sort, detailColumns)}.`);
    titleRows.push(`Kỳ theo ngày tạo đơn. Dữ liệu cập nhật: ${snapshotAt?.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) ?? "Chưa xác định"}.`);
    titleRows.push("Thanh toán hiện tại trên hóa đơn; không phải tiền nhân viên bàn giao. Tổng tiền chỉ gồm phần xác định, không gồm đơn hủy hoặc hóa đơn gắn nhiều đơn giao.");
    if (canViewMoney && totals.missingInvoice) titleRows.push(`${totals.missingInvoice} đơn cần kiểm tra hóa đơn; ô trống không có nghĩa là bằng 0.`);
    const summarySheet: ExcelSheet = { name: "1. Theo nhân viên", titleRows, columns: summaryColumns, rows: summaryRows, footer: { branchName: "TỔNG", ...totals }, tablePreferenceKey: "report.delivery-invoice.staff" };
    const detailSheet: ExcelSheet = { name: "2. Chi tiết đơn giao", titleRows, columns: detailColumns, rows, tablePreferenceKey: "report.delivery-invoice.orders" };
    try {
      await exportReportToExcel({ kind: "fnb-shipper", mode: full ? "full" : "view", range, branchName: branchLabel,
        description: "Kỳ theo ngày tạo đơn. Thanh toán là số hiện tại trên hóa đơn, không phải tiền nhân viên bàn giao. Đơn hủy và hóa đơn gắn nhiều đơn giao không cộng vào tổng tiền.",
        sheets: full ? [summarySheet, detailSheet] : [tab === "staff" ? summarySheet : detailSheet], shouldSave: () => revision === exportRevision.current && scope === currentScope.current,
        onPrepared: (blob, filename) => { if (revision === exportRevision.current && scope === currentScope.current) setDownload({ url: URL.createObjectURL(blob), filename, revision, scope }); } });
      if (revision === exportRevision.current && scope === currentScope.current) toast({ title: "Đã tạo file Excel", variant: "success" });
    } catch (err) { if (revision === exportRevision.current && scope === currentScope.current) toast({ title: "Không xuất được báo cáo", description: err instanceof Error ? err.message : "", variant: "error" }); }
    finally { setExporting(false); }
  };
  return <div className="flex h-[calc(100vh-4rem)] flex-col overflow-y-auto">
    <ReportPageHeader title="Giao hàng theo nhân viên" subtitle="Đơn giao và thanh toán trên hóa đơn" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange} onExportView={() => void exportFile(false)} onExportFull={() => void exportFile(true)} exportDisabled={loading || !!error || exporting || invalidFilters || !rows.length || !scopedReport} />
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{snapshotAt && scopedReport ? `Cập nhật: ${snapshotAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}</span>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(false)}><Icon name="refresh" />Tải lại</Button>
      </div>
      {download && download.revision === exportRevision.current && download.scope === readScope && scopedReport && !loading && !error && <div className="flex flex-wrap items-center gap-3 border-l-4 border-status-success bg-status-success/5 p-3 text-sm">
        <a href={download.url} download={download.filename} className="inline-flex min-h-10 shrink-0 items-center gap-2 font-medium text-primary underline underline-offset-4"><Icon name="download" />Tải file Excel</a>
        <span className="min-w-0 break-all text-muted-foreground">{download.filename}</span>
      </div>}
      {error ? <LoadErrorState description={error} onRetry={() => void load()} /> : loading || !scopedReport ? <p role="status">Đang tải giao hàng…</p> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Đơn giao" value={formatNumber(totals.orders)} icon="local_shipping" bg="bg-primary/10" iconColor="text-primary" valueColor="text-primary" />
          <KpiCard label="Đã giao" value={formatNumber(totals.completed)} icon="check_circle" bg="bg-status-success/10" iconColor="text-status-success" valueColor="text-status-success" />
          <KpiCard label="Chưa phân công" value={formatNumber(totals.unassigned)} icon="person_search" bg="bg-status-warning/10" iconColor="text-status-warning" valueColor="text-status-warning" />
          <KpiCard label="Đã hủy" value={formatNumber(totals.cancelled)} icon="cancel" bg="bg-status-error/10" iconColor="text-status-error" valueColor="text-status-error" />
        </div>
        <DeliveryReportFilters rows={allRows} canViewMoney={canViewMoney} filters={permittedFilters} onChange={value => { exportRevision.current++; setFilters(value); }} summaryMetrics={permittedMetrics} onSummaryMetricsChange={value => { exportRevision.current++; setSummaryMetrics(value); }} tab={tab} />
        {invalidFilters && <p role="alert" className="text-sm text-destructive">Khoảng lọc không hợp lệ. Giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.</p>}
        {canViewMoney && totals.missingInvoice > 0 && <p role="status" className="border-l-4 border-status-warning bg-status-warning/10 p-3 text-sm">{totals.missingInvoice} đơn cần kiểm tra hóa đơn; tổng tiền chỉ gồm phần đã xác định, không gồm đơn hủy.</p>}
        <Tabs value={tab} onValueChange={value => { exportRevision.current++; setTab(value); }}><TabsList><TabsTrigger value="staff">Theo nhân viên</TabsTrigger><TabsTrigger value="orders">Chi tiết đơn</TabsTrigger></TabsList></Tabs>
        <h2 className="border-l-4 border-primary bg-primary/5 px-3 py-2 text-base font-semibold">{tab === "staff" ? "Tổng hợp giao hàng theo nhân viên" : "Chi tiết đơn giao"}</h2>
        {tab === "staff" ? <ReportDataTable columns={toWebColumns<typeof summaryRows[number]>(summaryColumns)} rows={summaryRows} getRowKey={row => row.id} tablePreferenceKey="report.delivery-invoice.staff" sortState={summarySort} onSortChange={value => { exportRevision.current++; setSummarySort(value); }} />
          : <ReportDataTable columns={toWebColumns<DeliveryInvoiceView>(detailColumns).map(column => ({ ...column, sortValue: (row: DeliveryInvoiceView) => deliverySortValue(row, String(column.key)) as string | number | null }))} rows={rows} getRowKey={row => row.id} tablePreferenceKey="report.delivery-invoice.orders" sortState={sort} onSortChange={value => { exportRevision.current++; setSort(value); }} />}
      </>}
    </div>
  </div>;
}
