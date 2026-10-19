"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cashDateTimeInput, formatCashBookDate } from "@/lib/cash-time";
import { ReportPageHeader, ReportDataTable, type DataTableColumn } from "@/components/shared/report";
import { ReportSection } from "@/components/shared/report/report-section";
import { MetricFilters } from "@/components/shared/report/metric-filters";
import { DebtDetailDialog } from "@/components/shared/dialogs/debt-detail-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { getDebtWorkspace, type DebtWorkspace } from "@/lib/services/supabase/debt-workspace";
import { DEBT_FIELDS, DEBT_GROUPS, DEBT_METRIC_FIELDS, DEBT_REVIEW_LABELS, debtCapitalRows, debtCapitalTotals, debtCapitalView, type DebtCapitalRow, type DebtReview } from "@/lib/reports/debt-capital";
import { metricFilterError, metricFilterLabel, parseMetricFilters, type MetricFilter } from "@/lib/reports/metric-filter";
import { exportReportToExcel, type ExcelSheet } from "@/lib/utils/excel-export";

type AgingMode = "receivable" | "payable";
const BASIS = "Số dư hiện tại. Nợ và tiền ứng tách riêng; số dư ròng = nợ − ứng, chưa tự cấn. Tuổi tính từ ngày chứng từ, không phải số ngày quá hạn.";
const money = (value: number | null) => value === null ? "Chưa đủ dữ liệu" : formatCurrency(value);
const metricKeys = DEBT_METRIC_FIELDS.map(field => field.key as string);

export default function DebtAgingReportPage() {
  const { tenant, hasPermission } = useAuth();
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultViewMode: "table", forceTable: true });
  const [mode, setMode] = useState<AgingMode>("receivable");
  const [data, setData] = useState<DebtWorkspace | null>(null);
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<DebtReview>("all");
  const [metrics, setMetrics] = useState<MetricFilter[]>([]);
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "debt", direction: "desc" });
  const [ready, setReady] = useState(false);
  const [loadedScope, setLoadedScope] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<DebtCapitalRow | null>(null);
  const scope = `${tenant?.id}:${activeBranchId ?? "all"}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const flight = useRef<{ scope: string; pending: boolean; queued: boolean }>({ scope: "", pending: false, queued: false });
  const refresh = useCallback(() => {
    if (flight.current.scope === scope && flight.current.pending) flight.current.queued = true;
    else setRevision(value => value + 1);
  }, [scope]);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId ?? undefined, ["dashboard_live_signals"], isReady && ready);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("debtMode") === "payable") setMode("payable");
    setSearch(query.get("debtSearch") ?? "");
    const savedReview = query.get("debtReview");
    if (savedReview && savedReview in DEBT_REVIEW_LABELS) setReview(savedReview as DebtReview);
    const savedSort = query.get("debtSort");
    if (DEBT_FIELDS.some(field => field.key === savedSort)) setSort({ id: savedSort!, direction: query.get("debtDirection") === "asc" ? "asc" : "desc" });
    setMetrics(parseMetricFilters(query.get("debtMetrics"), metricKeys));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ debtMode: mode, debtSearch: search, debtReview: review, debtSort: sort.id, debtDirection: sort.direction, debtMetrics: metrics.length ? JSON.stringify(metrics) : "" })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url);
  }, [ready, mode, search, review, sort, metrics]);
  useEffect(() => { setDetail(null); }, [scope, mode]);
  useEffect(() => {
    if (!isReady || !ready || !tenant?.id) return;
    let active = true;
    const request = { scope, pending: true, queued: false };
    flight.current = request;
    getDebtWorkspace(activeBranchId, { requireBalanceSummary: true }).then(result => {
      if (!active || scopeRef.current !== scope) return;
      setData(result); setLoadedScope(scope); setError(null);
    }).catch(reason => {
      if (!active || scopeRef.current !== scope) return;
      setError(reason instanceof Error ? reason.message : "Không tải được công nợ"); setLoadedScope(scope);
    }).finally(() => {
      request.pending = false;
      if (active && request.queued) setRevision(value => value + 1);
    });
    return () => { active = false; };
  }, [activeBranchId, scope, isReady, ready, revision, tenant?.id]);

  const pending = !isReady || !ready || loadedScope !== scope;
  const unavailable = pending || Boolean(error);
  const receivables = useMemo(() => debtCapitalRows(data?.receivables ?? []), [data]);
  const payables = useMemo(() => debtCapitalRows(data?.payables ?? []), [data]);
  const filters = useMemo(() => ({ search, review, metrics }), [search, review, metrics]);
  const filteredReceivables = useMemo(() => debtCapitalView(receivables, filters, sort), [receivables, filters, sort]);
  const filteredPayables = useMemo(() => debtCapitalView(payables, filters, sort), [payables, filters, sort]);
  const rows = mode === "receivable" ? filteredReceivables : filteredPayables;
  const totals = debtCapitalTotals(rows);
  const canDrill = hasPermission(mode === "receivable" ? "customers.view_debt" : "suppliers.view_debt");
  const columns: DataTableColumn<DebtCapitalRow>[] = DEBT_FIELDS.map(field => ({
    key: field.key, label: field.label, sortable: true,
    sticky: field.key === "code", hideable: field.key !== "code",
    width: field.key === "name" ? "240px" : "160px",
    align: metricKeys.includes(field.key) ? "right" : "left",
    cell: row => {
      if (field.key === "code") return canDrill && /^[0-9a-f-]{36}$/i.test(row.id)
        ? <button type="button" className="min-h-9 text-left font-medium text-primary underline-offset-2 hover:underline" onClick={() => setDetail(row)} aria-label={`Xem chứng từ ${row.code}`}>{row.code}</button> : row.code;
      if (field.key === "oldestDocumentDate") return row.oldestDocumentDate ? formatCashBookDate(row.oldestDocumentDate) : "—";
      if (field.key === "ageDays") return row.documentCount > 0 ? formatNumber(row.ageDays) : "—";
      if (field.key === "documentCount") return formatNumber(row.documentCount);
      if (metricKeys.includes(field.key)) return <span className="tabular-nums">{money(row[field.key] as number | null)}</span>;
      return row[field.key] ?? "—";
    },
    subtotalCell: field.key === "code" ? "TỔNG" : field.key in totals ? money(totals[field.key as keyof typeof totals]) : undefined,
  }));
  const snapshot = data ? cashDateTimeInput(new Date(data.generatedAt)).slice(0, 10) : "";
  const handleExport = async (exportMode: "view" | "full") => {
    if (unavailable || exporting || metricFilterError(metrics) || !data) return;
    setExporting(true);
    try {
      const titleRows = ["CÔNG NỢ VÀ TUỔI CHỨNG TỪ", `${branchLabel} · Số dư hiện tại ${snapshot}`, BASIS,
        `Tìm: ${search || "Tất cả"} · ${DEBT_REVIEW_LABELS[review]}`,
        `Chỉ tiêu: ${metricFilterLabel(metrics, DEBT_METRIC_FIELDS)}`,
        `Sắp xếp: ${DEBT_FIELDS.find(field => field.key === sort.id)?.label} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`];
      const detailSheet = (side: AgingMode, entries: DebtCapitalRow[]): ExcelSheet => ({
        name: side === "receivable" ? "Chi tiết phải thu" : "Chi tiết phải trả", titleRows,
        ...(exportMode === "view" ? { tablePreferenceKey: `report.debt-aging.${side}` } : {}),
        columns: DEBT_FIELDS.map(field => ({ key: field.key, label: field.label, hideable: field.key !== "code", width: field.key === "name" ? 32 : 22,
          format: metricKeys.includes(field.key) ? "number" : "text", decimalPlaces: field.key === "documentCount" || field.key === "ageDays" ? 0 : 2 })),
        rows: entries.map(row => Object.fromEntries(DEBT_FIELDS.map(field => [field.key, field.key === "oldestDocumentDate" ? (row.oldestDocumentDate ? formatCashBookDate(row.oldestDocumentDate) : "") : field.key === "ageDays" && row.documentCount === 0 ? null : row[field.key]]))),
        footer: { code: "TỔNG", ...debtCapitalTotals(entries) },
      });
      const summarySheet = (side: AgingMode, entries: DebtCapitalRow[]): ExcelSheet => ({
        name: side === "receivable" ? "Tổng quan phải thu" : "Tổng quan phải trả", titleRows,
        columns: [{ key: "label", label: "Chỉ tiêu", width: 35 }, { key: "amount", label: "Giá trị", format: "number", decimalPlaces: 2, width: 24 }],
        rows: Object.entries(debtCapitalTotals(entries)).map(([key, amount]) => ({ label: DEBT_FIELDS.find(field => field.key === key)?.label ?? key, amount })),
      });
      await exportReportToExcel({ kind: "cong-no-aging", mode: exportMode, range: { from: snapshot, to: snapshot }, tenantName: tenant?.name ?? "OneBiz",
        sheets: exportMode === "view" ? [detailSheet(mode, rows)] : [summarySheet("receivable", filteredReceivables), detailSheet("receivable", filteredReceivables), summarySheet("payable", filteredPayables), detailSheet("payable", filteredPayables)] });
      toast({ title: "Đã xuất báo cáo công nợ", variant: "success" });
    } catch (reason) { toast({ title: "Không xuất được báo cáo", description: reason instanceof Error ? reason.message : "Vui lòng thử lại", variant: "error" }); }
    finally { setExporting(false); }
  };

  return <div className="min-w-0 space-y-4 p-3 md:p-5">
    <ReportPageHeader title="Công nợ và tuổi chứng từ" subtitle="Số dư hiện tại · Cùng nguồn trang Công nợ" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
      onExportView={() => handleExport("view")} onExportFull={() => handleExport("full")} exportDisabled={unavailable || exporting || metricFilterError(metrics)} hideDateRange />
    <Tabs value={mode} onValueChange={value => setMode(value as AgingMode)}>
      <TabsList className="grid h-auto w-full max-w-2xl grid-cols-2 p-1">
        {(["receivable", "payable"] as const).map(side => <TabsTrigger key={side} value={side} className="min-h-12 min-w-0 whitespace-normal px-2 text-left">
          <span><span className="block text-xs">{side === "receivable" ? "Phải thu khách hàng" : "Phải trả nhà cung cấp"}</span><span className="block font-semibold tabular-nums">{unavailable ? "—" : money(debtCapitalTotals(side === "receivable" ? receivables : payables).debt) + " đ"}</span></span>
        </TabsTrigger>)}
      </TabsList>
    </Tabs>
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Tìm đối tác" placeholder="Mã, tên, điện thoại" value={search} onChange={event => setSearch(event.target.value)} className="w-full sm:w-72" />
      <select aria-label="Nhóm kiểm tra công nợ" value={review} onChange={event => setReview(event.target.value as DebtReview)} className="h-10 max-w-full rounded border bg-background px-2 text-sm">{Object.entries(DEBT_REVIEW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button type="button" className="min-h-10 px-2 text-sm text-primary" onClick={() => { setSearch(""); setReview("all"); setMetrics([]); }}>Xóa bộ lọc</button>
      <Link href="/tai-chinh/cong-no" className="min-h-10 px-2 py-2 text-sm text-primary">Mở công nợ</Link>
    </div>
    <MetricFilters fields={DEBT_METRIC_FIELDS} value={metrics} onChange={setMetrics} />
    <p className="text-xs leading-5 text-muted-foreground">{BASIS}</p>
    {pending ? <p role="status" className="py-12 text-center">Đang tải công nợ...</p> : error ? <div role="alert" className="border-y border-destructive/40 py-6 text-destructive"><p>{error}</p><button type="button" className="mt-2 min-h-10 underline" onClick={refresh}>Thử lại</button></div> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[{ label: "Nợ chứng từ", value: totals.debt }, { label: mode === "receivable" ? "Khách trả trước còn dư" : "Ứng NCC còn dư", value: totals.advance }, { label: "Có thể đối chiếu cấn", value: totals.availableOffset }, { label: "Nợ trên 90 ngày", value: totals.bucket91Plus }].map(item => <div key={item.label} className="min-w-0 border-l-2 border-primary/30 py-2 pl-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className="break-words text-lg font-semibold tabular-nums">{money(item.value)} đ</p><p className="text-xs text-muted-foreground">Theo bộ lọc · {rows.length} đối tác</p></div>)}
      </div>
      <ReportSection title="Cần đối chiếu" tone="review" subtitle="Không tự cấn tiền ứng hoặc ghi nhận thêm thu chi.">
        <div className="grid gap-4 divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
          {([{ key: "both", label: "Nợ và tiền ứng", note: "Đối chiếu nguồn ứng với chứng từ cùng đối tác trước khi cấn." }, { key: "older90", label: "Nợ trên 90 ngày", note: mode === "receivable" ? "Rà soát chứng từ và lập lịch thu tiền." : "Đối chiếu nhà cung cấp và lập lịch thanh toán." }, { key: "gap", label: "Lệch phân tuổi", note: "Kiểm tra nguồn và nhóm tuổi; không tự phân bổ chênh lệch." }] as const).map(item => {
            const count = debtCapitalView(mode === "receivable" ? receivables : payables, { search, metrics, review: item.key }, null).length;
            return <div key={item.key} className="min-w-0 px-3 py-2"><p className="font-medium">{item.label} · {formatNumber(count)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p><button type="button" disabled={!count} className="mt-1 min-h-10 text-sm text-primary disabled:opacity-40" onClick={() => setReview(item.key)}>Xem đối tác</button></div>;
          })}
        </div>
      </ReportSection>
      <ReportSection title={mode === "receivable" ? "Chi tiết phải thu" : "Chi tiết phải trả"} tone="primary" subtitle="Số dư ròng âm là tiền ứng lớn hơn nợ; chứng từ chưa cấn vẫn hiển thị.">
        <ReportDataTable tablePreferenceKey={`report.debt-aging.${mode}`} columns={columns} columnGroups={DEBT_GROUPS} rows={rows} getRowKey={row => row.id} sortState={sort} onSortChange={setSort}
          className="[&_thead_tr:first-child_th]:border-r [&_thead_tr:first-child_th]:text-left" subtotalLabel={`${rows.length} đối tác theo bộ lọc`} emptyState={<p className="py-12 text-center text-muted-foreground">Không có đối tác phù hợp bộ lọc</p>} />
      </ReportSection>
      <p className="text-xs text-muted-foreground">Cập nhật: {data ? new Date(data.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—"}. Không bù trừ giữa các đối tác.</p>
    </>}
    {detail && !unavailable && <DebtDetailDialog open onOpenChange={open => { if (!open) setDetail(null); }} mode={mode === "receivable" ? "customer" : "supplier"} partyId={detail.id} branchId={activeBranchId} partyName={detail.name} partyCode={detail.code} estimatedDebt={detail.debt} />}
  </div>;
}
