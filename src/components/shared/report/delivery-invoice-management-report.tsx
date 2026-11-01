"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportPageHeader, ReportDataTable, type DataTableColumn } from "@/components/shared/report";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
import { getDeliveryInvoiceManagement, type DeliveryInvoiceReport } from "@/lib/services/supabase/delivery-invoice-management";
import { deliveryInvoiceView, filterDeliveryRows, summarizeDeliveryRows, deliveryManagementColumns, deliverySortValue, sortDeliveryRows, DELIVERY_STATUS_LABELS, INVOICE_PAYMENT_LABELS, type DeliveryInvoiceView } from "@/lib/reports/delivery-invoice-view";
import { sortedReportView } from "@/lib/reports/table-sort";
import { exportReportToExcel, buildReportTitleRows, type ExcelSheet } from "@/lib/utils/excel-export";
import { formatCurrency, formatNumber } from "@/lib/format";
import { LoadErrorState } from "@/components/shared/load-error-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/app/(main)/phan-tich/_components";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Sort = { id: string; direction: "asc" | "desc" } | null;
const EMPTY_FILTERS = { search: "", staff: "", status: "", method: "" };
export default function DeliveryInvoiceManagementReport() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "today", defaultViewMode: "table" });
  const [report, setReport] = useState<DeliveryInvoiceReport | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS), [tab, setTab] = useState("staff");
  const [sort, setSort] = useState<Sort>(null), [summarySort, setSummarySort] = useState<Sort>(null);
  const [exporting, setExporting] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);
  const requestIdRef = useRef(0), exportRevision = useRef(0);
  const load = useCallback(async (resetFilters = true) => {
    const requestId = ++requestIdRef.current; exportRevision.current++;
    setLoading(true); setError(null); setReport(null); setSnapshotAt(null); if (resetFilters) setFilters(EMPTY_FILTERS);
    try { const data = await getDeliveryInvoiceManagement(activeBranchId, range); if (requestId !== requestIdRef.current) return; setReport(data); setSnapshotAt(new Date()); }
    catch (err) { if (requestId === requestIdRef.current) setError(err instanceof Error ? err.message : "Không tải được giao hàng."); }
    finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [activeBranchId, range]);
  useEffect(() => { if (isReady) void load(); return () => { requestIdRef.current++; exportRevision.current++; }; }, [isReady, load]);
  const allRows = useMemo(() => deliveryInvoiceView(report?.items ?? []), [report]);
  const filtered = useMemo(() => filterDeliveryRows(allRows, filters), [allRows, filters]);
  const rows = useMemo(() => sortDeliveryRows(filtered, sort), [filtered, sort]);
  const totals = summarizeDeliveryRows(filtered);
  const canViewMoney = report?.canViewMoney ?? false;
  const summary = useMemo(() => {
    const groups = new Map<string, DeliveryInvoiceView[]>();
    for (const row of filtered) groups.set(row.staffKey, [...(groups.get(row.staffKey) ?? []), row]);
    return [...groups.entries()].map(([id, group]) => ({ id, branchName: group[0].branchName, staffName: group[0].staffName, ...summarizeDeliveryRows(group) }));
  }, [filtered]);
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
  const changeFilter = (key: keyof typeof filters, value: string) => { exportRevision.current++; setFilters(previous => ({ ...previous, [key]: value })); };
  const exportFile = async (full: boolean) => {
    const revision = exportRevision.current; setExporting(true);
    const titleRows = buildReportTitleRows({ title: "Giao hàng theo nhân viên", range, branchName: branchLabel, generatedAt: new Date() });
    titleRows.push(`Nhân viên: ${filters.staff ? allRows.find(row => row.staffKey === filters.staff)?.staffName ?? "Chưa xác định" : "Tất cả"}; Trạng thái: ${DELIVERY_STATUS_LABELS[filters.status as keyof typeof DELIVERY_STATUS_LABELS] ?? "Tất cả"}; Thanh toán: ${(INVOICE_PAYMENT_LABELS[filters.method] ?? filters.method) || "Tất cả"}; Tìm kiếm: ${filters.search || "Không"}`);
    titleRows.push(`Kỳ theo ngày tạo đơn. Dữ liệu cập nhật: ${snapshotAt?.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) ?? "Chưa xác định"}.`);
    titleRows.push("Thanh toán hiện tại trên hóa đơn; không phải tiền nhân viên bàn giao. Tổng tiền chỉ gồm phần xác định, không gồm đơn hủy hoặc hóa đơn gắn nhiều đơn giao.");
    if (canViewMoney && totals.missingInvoice) titleRows.push(`${totals.missingInvoice} đơn cần kiểm tra hóa đơn; ô trống không có nghĩa là bằng 0.`);
    const summarySheet: ExcelSheet = { name: "1. Theo nhân viên", titleRows, columns: summaryColumns, rows: summaryRows, footer: { branchName: "TỔNG", ...totals }, tablePreferenceKey: "report.delivery-invoice.staff" };
    const detailSheet: ExcelSheet = { name: "2. Chi tiết đơn giao", titleRows, columns: detailColumns, rows, tablePreferenceKey: "report.delivery-invoice.orders" };
    try {
      await exportReportToExcel({ kind: "fnb-shipper", mode: full ? "full" : "view", range, branchName: branchLabel,
        description: "Kỳ theo ngày tạo đơn. Thanh toán là số hiện tại trên hóa đơn, không phải tiền nhân viên bàn giao. Đơn hủy và hóa đơn gắn nhiều đơn giao không cộng vào tổng tiền.",
        sheets: full ? [summarySheet, detailSheet] : [tab === "staff" ? summarySheet : detailSheet], shouldSave: () => revision === exportRevision.current });
      toast({ title: "Đã xuất báo cáo giao hàng", variant: "success" });
    } catch (err) { toast({ title: "Không xuất được báo cáo", description: err instanceof Error ? err.message : "", variant: "error" }); }
    finally { setExporting(false); }
  };
  return <div className="flex h-[calc(100vh-4rem)] flex-col overflow-y-auto">
    <ReportPageHeader title="Giao hàng theo nhân viên" subtitle="Đơn giao và thanh toán trên hóa đơn" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange} onExportView={() => void exportFile(false)} onExportFull={() => void exportFile(true)} exportDisabled={loading || !!error || exporting || !rows.length} />
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{snapshotAt ? `Cập nhật: ${snapshotAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}</span>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(false)}><Icon name="refresh" />Tải lại</Button>
      </div>
      {error ? <LoadErrorState description={error} onRetry={() => void load()} /> : loading ? <p role="status">Đang tải giao hàng…</p> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Đơn giao" value={formatNumber(totals.orders)} icon="local_shipping" bg="bg-primary/10" iconColor="text-primary" valueColor="text-primary" />
          <KpiCard label="Đã giao" value={formatNumber(totals.completed)} icon="check_circle" bg="bg-status-success/10" iconColor="text-status-success" valueColor="text-status-success" />
          <KpiCard label="Chưa phân công" value={formatNumber(totals.unassigned)} icon="person_search" bg="bg-status-warning/10" iconColor="text-status-warning" valueColor="text-status-warning" />
          <KpiCard label="Đã hủy" value={formatNumber(totals.cancelled)} icon="cancel" bg="bg-status-error/10" iconColor="text-status-error" valueColor="text-status-error" />
        </div>
        <div className="grid gap-3 border-y py-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-sm"><span>Tìm đơn, hóa đơn, khách</span><Input value={filters.search} onChange={event => changeFilter("search", event.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>Nhân viên / chi nhánh</span><select className="h-9 w-full rounded-md border bg-background px-2" value={filters.staff} onChange={event => changeFilter("staff", event.target.value)}><option value="">Tất cả nhân viên</option>{[...new Map(allRows.map(row => [row.staffKey, row])).values()].map(row => <option key={row.staffKey} value={row.staffKey}>{row.branchName} · {row.staffName}</option>)}</select></label>
          <label className="space-y-1 text-sm"><span>Trạng thái giao</span><select className="h-9 w-full rounded-md border bg-background px-2" value={filters.status} onChange={event => changeFilter("status", event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {canViewMoney && <label className="space-y-1 text-sm"><span>Thanh toán trên hóa đơn</span><select className="h-9 w-full rounded-md border bg-background px-2" value={filters.method} onChange={event => changeFilter("method", event.target.value)}><option value="">Tất cả hình thức</option>{[...new Set(allRows.flatMap(row => row.paymentMethod ? [row.paymentMethod] : []))].map(method => <option key={method} value={method}>{INVOICE_PAYMENT_LABELS[method] ?? method}</option>)}</select></label>}
        </div>
        {canViewMoney && totals.missingInvoice > 0 && <p role="status" className="border-l-4 border-status-warning bg-status-warning/10 p-3 text-sm">{totals.missingInvoice} đơn cần kiểm tra hóa đơn; tổng tiền chỉ gồm phần đã xác định, không gồm đơn hủy.</p>}
        <Tabs value={tab} onValueChange={value => { exportRevision.current++; setTab(value); }}><TabsList><TabsTrigger value="staff">Theo nhân viên</TabsTrigger><TabsTrigger value="orders">Chi tiết đơn</TabsTrigger></TabsList></Tabs>
        <h2 className="border-l-4 border-primary bg-primary/5 px-3 py-2 text-base font-semibold">{tab === "staff" ? "Tổng hợp giao hàng theo nhân viên" : "Chi tiết đơn giao"}</h2>
        {tab === "staff" ? <ReportDataTable columns={toWebColumns<typeof summaryRows[number]>(summaryColumns)} rows={summaryRows} getRowKey={row => row.id} tablePreferenceKey="report.delivery-invoice.staff" sortState={summarySort} onSortChange={value => { exportRevision.current++; setSummarySort(value); }} />
          : <ReportDataTable columns={toWebColumns<DeliveryInvoiceView>(detailColumns).map(column => ({ ...column, sortValue: (row: DeliveryInvoiceView) => deliverySortValue(row, String(column.key)) as string | number | null }))} rows={rows} getRowKey={row => row.id} tablePreferenceKey="report.delivery-invoice.orders" sortState={sort} onSortChange={value => { exportRevision.current++; setSort(value); }} />}
      </>}
    </div>
  </div>;
}
