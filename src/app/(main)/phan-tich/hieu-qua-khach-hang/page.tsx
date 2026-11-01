"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReportDataTable, ReportPageHeader, type DataTableColumn } from "@/components/shared/report";
import { ReportSection } from "@/components/shared/report/report-section";
import { MetricFilters } from "@/components/shared/report/metric-filters";
import { SummaryCard } from "@/components/shared/summary-card";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { getCustomerFinancialReport, type CustomerFinancialRow } from "@/lib/services/supabase/customer-financial-report";
import { getProfitAndLoss } from "@/lib/services/supabase/reports";
import { compareCustomerPeriods, customerFinancialTotals, customerKey, customerProfitabilityView, CUSTOMER_COLUMN_GROUPS, CUSTOMER_FINANCIAL_FIELDS, CUSTOMER_METRIC_FIELDS, CUSTOMER_REVIEW_LABELS, type CustomerProfitabilityRow, type CustomerReview } from "@/lib/reports/customer-profitability";
import { managementComparisonRange, managementReportLink, reportChange } from "@/lib/reports/management-review";
import { metricFilterError, metricFilterLabel, parseMetricFilters, type MetricFilter } from "@/lib/reports/metric-filter";
import { formatCurrency, formatShortDate, formatStockQuantity } from "@/lib/format";
import { formatCashBookDate } from "@/lib/cash-time";
import { buildReportTitleRows, exportReportToExcel } from "@/lib/utils/excel-export";

const KEY = "report.customer-profitability";
const money = (value: number | null) => value === null ? "Chưa đủ giá vốn" : formatCurrency(value);

export default function CustomerProfitabilityPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { tenant } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table", forceTable: true });
  const [data, setData] = useState<CustomerFinancialRow[]>([]);
  const [previous, setPrevious] = useState<CustomerFinancialRow[]>([]);
  const [headerRevenue, setHeaderRevenue] = useState<{ current: number; previous: number } | null>(null);
  const [reconciliationError, setReconciliationError] = useState(false);
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<CustomerReview>("all");
  const [metrics, setMetrics] = useState<MetricFilter[]>([]);
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "netRevenue", direction: "desc" });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const scope = `${tenant?.id}:${activeBranchId ?? "all"}:${range.from}:${range.to}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const refreshState = useRef({ scope: "", inFlight: false, queued: false });
  const refresh = useCallback(() => {
    if (refreshState.current.scope === scope && refreshState.current.inFlight) refreshState.current.queued = true;
    else setRevision(value => value + 1);
  }, [scope]);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals"], isReady && ready);
  const comparison = useMemo(() => managementComparisonRange(range), [range]);
  const comparisonLabel = comparison ? `So với ${formatCashBookDate(comparison.from)} - ${formatCashBookDate(comparison.to)}` : "Chưa có kỳ đối chiếu";
  const pending = loading || loadedScope !== scope || !isReady || !ready;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("customerSearch") ?? "");
    const value = params.get("customerReview");
    if (value && Object.hasOwn(CUSTOMER_REVIEW_LABELS, value)) setReview(value as CustomerReview);
    const key = params.get("customerSort");
    if (CUSTOMER_FINANCIAL_FIELDS.some(([field]) => field === key)) setSort({ id: key!, direction: params.get("customerDirection") === "asc" ? "asc" : "desc" });
    setMetrics(parseMetricFilters(params.get("customerMetrics"), CUSTOMER_METRIC_FIELDS.map(field => field.key)));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ customerSearch: search, customerReview: review === "all" ? "" : review, customerSort: sort.id, customerDirection: sort.direction, customerMetrics: metrics.length ? JSON.stringify(metrics) : "" })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [ready, search, review, sort, metrics]);
  useEffect(() => {
    let cancelled = false;
    if (!isReady || !ready) return;
    refreshState.current = { scope, inFlight: true, queued: false };
    setLoading(true); setError("");
    Promise.all([
      getCustomerFinancialReport(range, activeBranchId),
      comparison ? getCustomerFinancialReport(comparison, activeBranchId) : Promise.reject(new Error("Khoảng thời gian không hợp lệ")),
      getProfitAndLoss(activeBranchId, range).then(value => ({ current: value.current.goodsRevenue, previous: value.previous.goodsRevenue })).catch(() => null),
    ]).then(([current, prior, headers]) => {
      if (cancelled || scopeRef.current !== scope) return;
      setData(current); setPrevious(prior); setHeaderRevenue(headers); setReconciliationError(!headers);
      setLoadedScope(scope); setUpdatedAt(new Date().toISOString());
    }).catch(reason => {
      if (!cancelled && scopeRef.current === scope) setError(reason instanceof Error ? reason.message : "Không tải được báo cáo");
    }).finally(() => {
      if (cancelled || scopeRef.current !== scope) return;
      setLoading(false);
      const queued = refreshState.current.queued;
      refreshState.current.inFlight = false;
      if (queued) setRevision(value => value + 1);
    });
    return () => { cancelled = true; };
  }, [range, activeBranchId, isReady, ready, comparison, scope, revision]);
  const all = useMemo(() => compareCustomerPeriods(data, previous), [data, previous]);
  const rows = useMemo(() => customerProfitabilityView(all, search, review, metrics, sort), [all, search, review, metrics, sort]);
  const totals = useMemo(() => customerFinancialTotals(rows), [rows]);
  const priorTotals = useMemo(() => customerFinancialTotals(rows.flatMap(row => row.previousRow ? [row.previousRow] : [])), [rows]);
  const currentAll = useMemo(() => customerFinancialTotals(data), [data]);
  const previousAll = useMemo(() => customerFinancialTotals(previous), [previous]);
  const filtered = Boolean(search || review !== "all" || metrics.length);
  const reconciliationRows = headerRevenue ? [
    { name: "Tổng hàng hóa trên hóa đơn", current: headerRevenue.current, previous: headerRevenue.previous },
    { name: "Doanh thu dòng hàng theo khách", current: currentAll.netRevenue, previous: previousAll.netRevenue },
    { name: "Chênh lệch chưa phân loại", current: headerRevenue.current - currentAll.netRevenue, previous: headerRevenue.previous - previousAll.netRevenue },
  ] : [];
  const mismatch = reconciliationRows.some(row => row.name === "Chênh lệch chưa phân loại" && (Math.abs(row.current) >= 0.005 || Math.abs(row.previous) >= 0.005));
  const columns: DataTableColumn<CustomerProfitabilityRow>[] = CUSTOMER_FINANCIAL_FIELDS.map(([key, label]) => ({
    key, label, width: key === "name" ? "280px" : "180px", align: ["code", "name", "lastActivityAt"].includes(key) ? "left" : "right", sticky: key === "code", hideable: key !== "code",
    cell: row => {
      if (key === "code") return row.customerId && row.code ? <Link className="text-primary underline-offset-2 hover:underline" href={managementReportLink("/phan-tich/sku-chi-tiet", activeBranchId, range) + `&customer=${encodeURIComponent(row.customerId)}`}>{row.code}</Link> : "Chưa gắn mã";
      if (key === "name") return row.name;
      if (key === "lastActivityAt") return row.lastActivityAt ? formatShortDate(row.lastActivityAt) : "—";
      if (["orders", "returns", "products", "missingCostLines", "previousMissingCostLines"].includes(key)) return formatStockQuantity(row[key] as number);
      if (key === "marginPercent") return row.marginPercent === null ? "—" : formatStockQuantity(row.marginPercent);
      if (key === "averageOrderValue") return row.averageOrderValue === null ? "—" : money(row.averageOrderValue);
      return money(row[key] as number | null);
    },
    subtotalCell: key in totals ? (key === "marginPercent" ? (totals.marginPercent === null ? "—" : formatStockQuantity(totals.marginPercent)) : key === "averageOrderValue" && totals.averageOrderValue === null ? "—" : ["orders", "returns", "missingCostLines"].includes(key) ? formatStockQuantity(totals[key as "orders"]) : money(totals[key as "netRevenue"])) :
      key === "previousRevenue" ? money(priorTotals.netRevenue) : key === "revenueDifference" ? money(totals.netRevenue - priorTotals.netRevenue) :
      key === "previousGrossProfit" ? money(priorTotals.grossProfit) : key === "grossProfitDifference" ? money(totals.grossProfit === null || priorTotals.grossProfit === null ? null : totals.grossProfit - priorTotals.grossProfit) :
      key === "previousMissingCostLines" ? formatStockQuantity(priorTotals.missingCostLines) : undefined,
  }));
  async function exportRows(mode: "view" | "full") {
    if (pending || error || exporting || metricFilterError(metrics)) return;
    setExporting(true);
    try {
      const titles = buildReportTitleRows({ title: "DOANH THU VÀ LÃI GỘP THEO KHÁCH HÀNG", range, branchName: branchLabel });
      titles.push(comparisonLabel, `Tìm: ${search || "Tất cả"}; Kiểm tra: ${CUSTOMER_REVIEW_LABELS[review]}; ${metricFilterLabel(metrics, CUSTOMER_METRIC_FIELDS)}`,
        `Sắp xếp: ${columns.find(column => column.key === sort.id)?.label} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`,
        "Gồm nội bộ, chưa loại trừ hợp nhất. Sau chiết khấu, chưa gồm VAT/phí giao. Trả hàng theo ngày phiếu trả. Giá vốn lịch sử; ô trống không phải 0. Lãi gộp chưa trừ chi phí vận hành.");
      await exportReportToExcel({ kind: "hieu-qua-khach-hang", mode, range, branchName: branchLabel, sheets: [{ name: "Doanh thu và lãi gộp KH", titleRows: titles, autoFilter: true,
        tablePreferenceKey: mode === "view" ? KEY : undefined, columnGroups: CUSTOMER_COLUMN_GROUPS,
        columns: CUSTOMER_FINANCIAL_FIELDS.map(([key, label]) => ({ key, label, width: key === "name" ? 36 : 24, hideable: key !== "code", decimalPlaces: ["orders", "returns", "products", "missingCostLines", "previousMissingCostLines"].includes(key) ? 0 : 2, format: ["code", "name", "lastActivityAt"].includes(key) ? undefined : "number" as const })),
        rows: rows.map(row => ({ ...row, code: row.code || "Chưa gắn mã" })),
        footer: { code: "TỔNG", ...totals, previousRevenue: priorTotals.netRevenue, revenueDifference: totals.netRevenue - priorTotals.netRevenue, previousGrossProfit: priorTotals.grossProfit, grossProfitDifference: totals.grossProfit === null || priorTotals.grossProfit === null ? null : totals.grossProfit - priorTotals.grossProfit, previousMissingCostLines: priorTotals.missingCostLines },
      }, ...(!filtered ? [{ name: "Đối chiếu hóa đơn", titleRows: titles, columns: [{ key: "name", label: "Chỉ tiêu", width: 40 }, { key: "current", label: "Kỳ này", format: "number" as const, decimalPlaces: 2 }, { key: "previous", label: "Kỳ trước", format: "number" as const, decimalPlaces: 2 }], rows: reconciliationError ? [{ name: "Chưa đối chiếu được", current: null, previous: null }] : reconciliationRows }] : [])] });
      toast({ title: "Đã xuất báo cáo", variant: "success" });
    } catch (reason) { toast({ title: "Không xuất được Excel", description: reason instanceof Error ? reason.message : "Vui lòng thử lại", variant: "error" }); }
    finally { setExporting(false); }
  }
  return <div className="flex min-h-full flex-col">
    <ReportPageHeader title="Doanh thu và lãi gộp theo khách hàng" subtitle={comparisonLabel} preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange} onExportView={() => exportRows("view")} onExportFull={() => exportRows("full")} exportDisabled={pending || Boolean(error) || exporting || !rows.length || metricFilterError(metrics)} />
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Tiền hàng bán" value={pending || error ? "—" : money(totals.salesAmount)} hint={pending || error ? "" : reportChange(totals.salesAmount, priorTotals.salesAmount)} />
        <SummaryCard label="Tiền hàng trả" value={pending || error ? "—" : money(totals.returnAmount)} hint={pending || error ? "" : reportChange(totals.returnAmount, priorTotals.returnAmount)} />
        <SummaryCard label="Doanh thu thuần" value={pending || error ? "—" : money(totals.netRevenue)} hint={pending || error ? "" : reportChange(totals.netRevenue, priorTotals.netRevenue)} highlight />
        <SummaryCard label="Lãi gộp" value={pending || error ? "—" : money(totals.grossProfit)} hint={pending || error || totals.grossProfit === null || priorTotals.grossProfit === null ? "" : reportChange(totals.grossProfit, priorTotals.grossProfit)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Tìm khách hàng" placeholder="Mã hoặc tên khách hàng" className="w-full sm:w-80" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="Nghiệp vụ cần xem" className="h-10 max-w-full rounded border bg-background px-3 text-sm" value={review} onChange={event => setReview(event.target.value as CustomerReview)}>{Object.entries(CUSTOMER_REVIEW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        {filtered && <button type="button" className="inline-flex min-h-9 items-center gap-1 text-sm text-primary" onClick={() => { setSearch(""); setReview("all"); setMetrics([]); }}><Icon name="filter_alt_off" size={18} />Xóa bộ lọc</button>}
        <Link className="inline-flex min-h-9 items-center gap-1 text-sm text-primary" href={managementReportLink("/phan-tich/khach-san-pham", activeBranchId, range)}>Lịch sử mua hàng<Icon name="arrow_forward" size={16} /></Link>
      </div>
      <MetricFilters fields={CUSTOMER_METRIC_FIELDS} value={metrics} onChange={setMetrics} />
      <p className="text-xs leading-5 text-muted-foreground">Đồng · Gồm nội bộ, chưa loại trừ hợp nhất · Sau chiết khấu, chưa gồm VAT/phí giao · Lãi gộp chưa trừ chi phí vận hành.</p>
      {error && <div role="alert" className="border-l-2 border-destructive p-3 text-sm">Chưa tải được báo cáo. {error}<button type="button" className="ml-3 text-primary underline" onClick={refresh}>Thử lại</button></div>}
      {!pending && !error && <>
        {!filtered && <ReportSection title="Đối chiếu doanh thu" tone="primary">
          {reconciliationError ? <p role="status" className="text-sm">Chưa tải được tổng hóa đơn để đối chiếu.</p> : <ReportDataTable tablePreferenceKey="report.customer-profitability.reconciliation" showDisplayOptions={false} rows={reconciliationRows} getRowKey={row => row.name} columns={[{ key: "name", label: "Chỉ tiêu", sticky: true, sortable: false }, { key: "current", label: "Kỳ này", align: "right", sortable: false, cell: row => money(row.current) }, { key: "previous", label: "Kỳ trước", align: "right", sortable: false, cell: row => money(row.previous) }]} />}
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{mismatch ? "Có chênh lệch chưa phân loại. Đối chiếu hóa đơn và dòng hàng; không tự bù số." : reconciliationError ? "Chưa kết luận đối chiếu." : "Hai nguồn khớp theo số liệu đã tải."}</p>
        </ReportSection>}
        <ReportSection title="Ưu tiên kiểm tra" subtitle={filtered ? "Trong phạm vi bộ lọc" : "Trong kỳ đang xem"} tone={rows.some(row => row.missingCostLines > 0 || row.revenueDifference < 0) ? "review" : "neutral"}>
          <div className="grid gap-3 md:grid-cols-3">
            {([
              { key: "decline", label: "Doanh thu giảm", count: rows.filter(row => row.revenueDifference < 0).length, hint: "Xem khách giảm mua, mở SKU để đối chiếu cơ cấu bán." },
              { key: "missing", label: "Chưa đủ giá vốn", count: rows.filter(row => row.missingCostLines + row.previousMissingCostLines > 0).length, hint: "Kiểm tra chứng từ gốc trước khi kết luận lãi gộp." },
              { key: "returns", label: "Có hàng trả", count: rows.filter(row => row.returns > 0).length, hint: "Đối chiếu hàng trả và thời điểm ghi nhận." },
            ] as const).map(item => <div key={item.key} className="border-l-2 pl-3"><div className="text-sm font-medium">{item.label}: {item.count}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.hint}</p><button type="button" className="mt-1 inline-flex min-h-9 items-center gap-1 text-sm text-primary" disabled={!item.count} onClick={() => setReview(item.key)}>Xem khách<Icon name="arrow_forward" size={16} /></button></div>)}
          </div>
        </ReportSection>
      </>}
      <ReportSection title="Chi tiết khách hàng" subtitle="Khách chỉ phát sinh kỳ trước vẫn được đối chiếu" tone="primary">
        {pending ? <p role="status" className="py-6 text-sm text-muted-foreground">Đang tải báo cáo…</p> : !error && <ReportDataTable tablePreferenceKey={KEY} columns={columns} columnGroups={CUSTOMER_COLUMN_GROUPS} rows={rows} getRowKey={customerKey} subtotalLabel={`${rows.length} khách/nhóm`} sortState={sort} onSortChange={setSort} className="[&_thead_tr:first-child_th]:border-r [&_thead_tr:first-child_th]:text-left" />}
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Giá trị HĐ bán BQ = tiền hàng bán / số hóa đơn bán; hàng trả trình bày riêng. Nhóm chưa gắn khách vẫn tính đủ tiền, không gộp vào khách có mã.</p>
        {updatedAt && !pending && !error && <p className="mt-1 text-xs text-muted-foreground">Cập nhật {new Date(updatedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}
      </ReportSection>
    </div>
  </div>;
}
