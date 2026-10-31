"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReportDataTable, ReportPageHeader, type DataTableColumn } from "@/components/shared/report";
import { SummaryCard } from "@/components/shared/summary-card";
import { MetricFilters } from "@/components/shared/report/metric-filters";
import { ReportSection } from "@/components/shared/report/report-section";
import { matchesMetricFilters, metricFilterError, metricFilterLabel, parseMetricFilters, type MetricFilter } from "@/lib/reports/metric-filter";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { managementComparisonRange, managementReportLink, reportChange } from "@/lib/reports/management-review";
import { compareSkuPeriods, filterSkuPerformance, skuCategoryPerformance, skuReviewEvidence, skuRowKey, SKU_COLUMN_GROUPS, type SkuPerformanceRow, type SkuReviewFilter } from "@/lib/reports/sku-performance";
import { formatCashBookDate } from "@/lib/cash-time";
import { Icon } from "@/components/ui/icon";
import { sortReportRows } from "@/lib/reports/table-sort";
import { getProfitAndLoss } from "@/lib/services/supabase/reports";
import { useReportState } from "@/lib/hooks/use-report-state";
import { formatCurrency, formatStockQuantity, formatShortDate } from "@/lib/format";
import { getSkuPeriodCostReport as getSkuFinancialReport, type SkuFinancialResult } from "@/lib/services/supabase/sku-financial-report";
import { skuFinancialView, skuFinancialTotals } from "@/lib/reports/sku-financial-view";
import { buildReportTitleRows, exportReportToExcel } from "@/lib/utils/excel-export";

const KEY = "report.sku-financial.detail";
const REVIEW_LABELS: Record<SkuReviewFilter, string> = { all: "Tất cả nghiệp vụ", loss: "Lãi gộp âm · có doanh thu", zeroRevenueCost: "Hàng doanh thu 0 · có giá vốn", missing: "Thiếu giá vốn", returns: "Có hàng trả", decline: "Doanh thu giảm" };
const SORT_KEYS = ["code", "name", "category", "unit", "soldQty", "averageSalePrice", "salesAmount", "returnedQty", "returnAmount", "netQty", "netRevenue", "previousRevenue", "revenueDifference", "cogs", "grossProfit", "previousGrossProfit", "grossProfitDifference", "marginPercent", "orders", "customers", "missingCostLines", "previousMissingCostLines", "lastActivityAt"];
SORT_KEYS.push("salesCost", "averageSalesCost", "returnsCost", "averageReturnsCost", "knownSoldQuantity", "missingSoldQuantity", "knownReturnedQuantity", "missingReturnedQuantity", "averageKnownSalesCost");
const METRIC_KEYS = SORT_KEYS.filter(key => !["code", "name", "category", "unit", "lastActivityAt"].includes(key));
const money = (value: number | null) => value === null ? "Chưa đủ giá vốn" : formatCurrency(value);
const quantity = (value: number | null) => value === null ? "Nhiều ĐVT" : formatStockQuantity(value);

export default function SkuFinancialPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { tenant } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table", forceTable: true });
  const [data, setData] = useState<SkuFinancialResult>({ rows: [], customers: [] });
  const [previous, setPrevious] = useState<SkuFinancialResult>({ rows: [], customers: [] });
  const [invoiceRevenue, setInvoiceRevenue] = useState<{ current: number; previous: number } | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [customer, setCustomer] = useState("");
  const [item, setItem] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "code", direction: "asc" });
  const [categorySort, setCategorySort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "netRevenue", direction: "desc" });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<SkuReviewFilter>("all");
  const [metricFilters, setMetricFilters] = useState<MetricFilter[]>([]);
  const [filtersReady, setFiltersReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [revision, setRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState("");
  const loadedScopeRef = useRef("");
  const scope = `${tenant?.id}:${activeBranchId ?? "all"}:${range.from}:${range.to}:${customer}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const refreshState = useRef({ scope: "", inFlight: false, queued: false });
  const refresh = useCallback(() => {
    if (refreshState.current.scope === scope && refreshState.current.inFlight) refreshState.current.queued = true;
    else setRevision(value => value + 1);
  }, [scope]);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals"], isReady && filtersReady);
  const comparison = useMemo(() => managementComparisonRange(range), [range]);
  const comparisonLabel = comparison ? `So với ${formatCashBookDate(comparison.from)} - ${formatCashBookDate(comparison.to)}` : "Chưa có kỳ đối chiếu";
  const pending = loading || loadedScope !== scope || !isReady || !filtersReady;
  const request = useRef(0);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCustomer(params.get("customer") ?? ""); setSearch(params.get("skuSearch") ?? "");
    setItem(params.get("skuItem") ?? "");
    setCategory(params.get("skuCategory") ?? ""); setUnit(params.get("skuUnit") ?? "");
    setMetricFilters(parseMetricFilters(params.get("skuMetrics"), METRIC_KEYS));
    const review = params.get("skuReview");
    if (review && ["all", "loss", "zeroRevenueCost", "missing", "returns", "decline"].includes(review)) setReviewFilter(review as SkuReviewFilter);
    const key = params.get("skuSort");
    if (key && SORT_KEYS.includes(key)) setSort({ id: key, direction: params.get("skuDirection") === "desc" ? "desc" : "asc" });
    setFiltersReady(true);
  }, []);
  useEffect(() => {
    if (!filtersReady) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ customer, skuItem: item, skuSearch: search, skuCategory: category, skuUnit: unit, skuReview: reviewFilter === "all" ? "" : reviewFilter, skuSort: sort.id, skuDirection: sort.direction, skuMetrics: metricFilters.length ? JSON.stringify(metricFilters) : "" })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [filtersReady, customer, item, search, category, unit, reviewFilter, sort, metricFilters]);
  useEffect(() => {
    const id = ++request.current;
    let cancelled = false;
    if (!isReady || !filtersReady) return;
    refreshState.current = { scope, inFlight: true, queued: false };
    setLoading(loadedScopeRef.current !== scope);
    setError(null);
    Promise.all([getSkuFinancialReport(range, activeBranchId, customer),
      comparison ? getSkuFinancialReport(comparison, activeBranchId, customer) : Promise.reject(new Error("Khoảng thời gian không hợp lệ")),
      !customer ? getProfitAndLoss(activeBranchId, range).then(value => ({ data: { current: value.current.goodsRevenue, previous: value.previous.goodsRevenue }, error: null })).catch((reason: unknown) => ({ data: null, error: reason instanceof Error ? reason.message : "Chưa tải được tổng hóa đơn" })) : Promise.resolve({ data: null, error: null })])
      .then(([result, prior, invoices]) => {
        if (cancelled || id !== request.current || scopeRef.current !== scope) return;
        setData(result); setPrevious(prior); setLoadedScope(scope); loadedScopeRef.current = scope;
        setInvoiceRevenue(invoices.data); setReconciliationError(invoices.error);
        setUpdatedAt(new Date().toISOString());
      })
      .catch(reason => { if (!cancelled && id === request.current && scopeRef.current === scope) setError(reason instanceof Error ? reason.message : "Không tải được báo cáo SKU."); })
      .finally(() => {
        if (cancelled || id !== request.current || scopeRef.current !== scope) return;
        setLoading(false);
        const queued = refreshState.current.queued;
        refreshState.current.inFlight = false;
        if (queued) setRevision(value => value + 1);
      });
    return () => { cancelled = true; };
  }, [range, activeBranchId, customer, isReady, filtersReady, scope, comparison, revision]);
  const comparisonRows = useMemo(() => compareSkuPeriods(data.rows, previous.rows), [data.rows, previous.rows]);
  const baseRows = useMemo(() => skuFinancialView(comparisonRows.filter(row => !item || skuRowKey(row) === item), { search, category, unit }, sort), [comparisonRows, item, search, category, unit, sort]);
  const rows = useMemo(() => filterSkuPerformance(baseRows, reviewFilter).filter(row => matchesMetricFilters(row, metricFilters)), [baseRows, reviewFilter, metricFilters]);
  const totals = useMemo(() => skuFinancialTotals(rows), [rows]);
  const priorTotals = useMemo(() => skuFinancialTotals(rows.flatMap(row => row.previousRow ? [row.previousRow] : [])), [rows]);
  const evidence = useMemo(() => skuReviewEvidence(baseRows), [baseRows]);
  const categories = useMemo(() => sortReportRows(skuCategoryPerformance(rows), row => row[categorySort.id as keyof typeof row], categorySort.direction), [rows, categorySort]);
  const reconciliationRows = useMemo(() => invoiceRevenue ? [
    { metric: "Tổng hàng hóa trên hóa đơn", current: invoiceRevenue.current, previous: invoiceRevenue.previous },
    { metric: "Doanh thu dòng hàng trước VAT", current: skuFinancialTotals(data.rows).netRevenue, previous: skuFinancialTotals(previous.rows).netRevenue },
    { metric: "Chênh lệch", current: invoiceRevenue.current - skuFinancialTotals(data.rows).netRevenue, previous: invoiceRevenue.previous - skuFinancialTotals(previous.rows).netRevenue },
  ] : [], [invoiceRevenue, data.rows, previous.rows]);
  const revenueMismatch = reconciliationRows.some(row => row.metric === "Chênh lệch" && (Math.abs(row.current) >= 0.005 || Math.abs(row.previous) >= 0.005));
  const unfiltered = !customer && !item && !search && !category && !unit && reviewFilter === "all" && metricFilters.length === 0;
  const customers = useMemo(() => pending || error ? [] : [...new Map([...data.customers, ...previous.customers].map(row => [row.id, row])).values()], [data.customers, previous.customers, pending, error]);
  const filterRows = pending || error ? [] : comparisonRows;
  const itemOptions = filterRows.map(row => ({ value: skuRowKey(row), label: row.name, meta: `${row.code} · ${row.unit || "Chưa có ĐVT"}` }));
  const selectedItem = filterRows.find(row => skuRowKey(row) === item);
  const filtersUnavailable = pending || Boolean(error);
  const resetFilters = () => { setSearch(""); setCustomer(""); setItem(""); setCategory(""); setUnit(""); setReviewFilter("all"); setMetricFilters([]); };
  const options = (key: "category" | "unit") => {
    const selected = key === "unit" ? unit : category;
    const values = new Set(filterRows.map(row => row[key]));
    if (!filtersUnavailable && selected) values.add(selected);
    return [{ value: "all", label: key === "category" ? "Tất cả nhóm hàng" : "Tất cả ĐVT" },
      ...[...values].filter(Boolean).sort((a,b) => a.localeCompare(b,"vi")).map(value => ({ value, label: value }))];
  };
  const columns: DataTableColumn<SkuPerformanceRow>[] = [
    { key: "code", label: "Mã hàng", sticky: true, hideable: false, width: "160px" },
    { key: "name", label: "Mặt hàng", width: "280px" },
    { key: "category", label: "Nhóm hàng", width: "170px" },
    { key: "unit", label: "ĐVT", width: "90px" },
    { key: "soldQty", label: "SL bán", align: "right", width: "140px", cell: row => quantity(row.soldQty), subtotalCell: quantity(totals.soldQty) },
    { key: "averageSalePrice", label: "Đơn giá bán BQ", align: "right", width: "170px", cell: row => row.averageSalePrice === null ? "—" : formatStockQuantity(row.averageSalePrice) },
    { key: "salesAmount", label: "Tiền hàng bán", align: "right", width: "180px", cell: row => money(row.salesAmount), subtotalCell: money(totals.salesAmount) },
    { key: "returnedQty", label: "SL trả", align: "right", width: "140px", cell: row => quantity(row.returnedQty), subtotalCell: quantity(totals.returnedQty) },
    { key: "returnAmount", label: "Tiền hàng trả", align: "right", width: "180px", cell: row => money(row.returnAmount), subtotalCell: money(totals.returnAmount) },
    { key: "netQty", label: "SL ròng", align: "right", width: "140px", cell: row => quantity(row.netQty), subtotalCell: quantity(totals.netQty) },
    { key: "netRevenue", label: "Doanh thu thuần", align: "right", width: "180px", cell: row => money(row.netRevenue), subtotalCell: money(totals.netRevenue) },
    { key: "previousRevenue", label: "Doanh thu kỳ trước", align: "right", width: "180px", cell: row => money(row.previousRevenue), subtotalCell: money(priorTotals.netRevenue) },
    { key: "revenueDifference", label: "Chênh lệch doanh thu", align: "right", width: "180px", cell: row => money(row.revenueDifference), subtotalCell: money(totals.netRevenue - priorTotals.netRevenue) },
    { key: "salesCost", label: "Giá vốn hàng bán", align: "right", width: "180px", cell: row => money(row.salesCost ?? null), subtotalCell: money(totals.salesCost) },
    { key: "averageSalesCost", label: "Đơn giá vốn bán BQ", align: "right", width: "180px", cell: row => row.soldQty === 0 ? "—" : money(row.averageSalesCost ?? null) },
    { key: "returnsCost", label: "Giá vốn hàng trả", align: "right", width: "180px", cell: row => money(row.returnsCost ?? null), subtotalCell: money(totals.returnsCost) },
    { key: "averageReturnsCost", label: "Đơn giá vốn trả BQ", align: "right", width: "180px", cell: row => row.returnedQty === 0 ? "—" : money(row.averageReturnsCost ?? null) },
    { key: "knownSoldQuantity", label: "SL bán có giá vốn", align: "right", width: "170px", cell: row => quantity(row.knownSoldQuantity ?? null) },
    { key: "missingSoldQuantity", label: "SL bán thiếu giá vốn", align: "right", width: "180px", cell: row => quantity(row.missingSoldQuantity ?? null) },
    { key: "knownReturnedQuantity", label: "SL trả có giá vốn", align: "right", width: "170px", cell: row => quantity(row.knownReturnedQuantity ?? null) },
    { key: "missingReturnedQuantity", label: "SL trả thiếu giá vốn", align: "right", width: "180px", cell: row => quantity(row.missingReturnedQuantity ?? null) },
    { key: "averageKnownSalesCost", label: "Đơn giá BQ phần đủ giá", align: "right", width: "200px", cell: row => (row.knownSoldQuantity ?? 0) === 0 ? "—" : money(row.averageKnownSalesCost ?? null) },
    { key: "cogs", label: "Giá vốn ròng", align: "right", width: "180px", cell: row => money(row.cogs), subtotalCell: money(totals.cogs) },
    { key: "grossProfit", label: "Lãi gộp", align: "right", width: "180px", cell: row => money(row.grossProfit), subtotalCell: money(totals.grossProfit) },
    { key: "previousGrossProfit", label: "Lãi gộp kỳ trước", align: "right", width: "180px", cell: row => money(row.previousGrossProfit), subtotalCell: money(priorTotals.grossProfit) },
    { key: "grossProfitDifference", label: "Chênh lệch lãi gộp", align: "right", width: "180px", cell: row => money(row.grossProfitDifference), subtotalCell: money(totals.grossProfit === null || priorTotals.grossProfit === null ? null : totals.grossProfit - priorTotals.grossProfit) },
    { key: "marginPercent", label: "Biên lãi gộp (%)", align: "right", width: "160px", cell: row => row.marginPercent === null ? "—" : formatStockQuantity(row.marginPercent) },
    { key: "orders", label: "Số hóa đơn bán", align: "right", width: "140px" },
    { key: "customers", label: "Số khách có mã", align: "right", width: "140px" },
    { key: "missingCostLines", label: "Dòng thiếu giá vốn", align: "right", width: "160px", subtotalCell: totals.missing },
    { key: "previousMissingCostLines", label: "Thiếu giá vốn kỳ trước", align: "right", width: "170px", subtotalCell: priorTotals.missing },
    { key: "lastActivityAt", label: "Phát sinh cuối", width: "150px", cell: row => formatShortDate(row.lastActivityAt) },
  ];
  async function exportRows(mode: "view" | "full") {
    if (pending || exporting || error) return;
    setExporting(true);
    try {
      const titles = buildReportTitleRows({ title: "CHI TIẾT BÁN HÀNG VÀ LÃI GỘP SKU", range, branchName: branchLabel });
      titles.push(comparisonLabel);
      titles.push(`Lọc chỉ tiêu: ${metricFilterLabel(metricFilters, columns.map(column => ({ key: String(column.key), label: column.label })))}`);
      titles.push(`Khách hàng: ${customer ? customers.find(row => row.id === customer)?.name ?? customer : "Tất cả"}; Mặt hàng: ${item ? selectedItem ? `${selectedItem.code} · ${selectedItem.name} · ${selectedItem.unit}` : "Không có phát sinh" : "Tất cả"}; Nhóm: ${category || "Tất cả"}; ĐVT: ${unit || "Tất cả"}; Tìm: ${search || "Tất cả"}; Kiểm tra: ${REVIEW_LABELS[reviewFilter]}; Sắp xếp: ${columns.find(column => column.key === sort.id)?.label ?? sort.id} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`);
      titles.push("Gồm nội bộ; không phải tổng hợp nhất. Mỗi size/quy cách là một dòng riêng. Mặt hàng chỉ bán kỳ trước vẫn được đối chiếu.");
      const reconciliationSheet = unfiltered ? [{ name: "Đối chiếu hóa đơn", titleRows: titles,
        columns: [{ key: "metric", label: "Chỉ tiêu", width: 38 }, { key: "current", label: "Kỳ này (đ)", format: "number" as const, decimalPlaces: 2, width: 24 }, { key: "previous", label: "Kỳ trước (đ)", format: "number" as const, decimalPlaces: 2, width: 24 }],
        rows: reconciliationError ? [{ metric: "Chưa đối chiếu được", current: null, previous: null }] : reconciliationRows,
      }] : [];
      titles.push("Tiền hàng sau chiết khấu, không gồm VAT/phí giao hàng. Chiết khấu hóa đơn phân bổ theo tiền hàng; trả hàng ghi nhận theo ngày phiếu trả. Giá vốn theo snapshot gốc, ô trống không phải 0.");
      titles.push("Đơn giá vốn bán BQ = giá vốn hàng bán / SL bán cùng SKU, size và ĐVT. Hàng trả tính riêng; BQ phần đủ giá không đại diện phần thiếu giá vốn. Không cộng đơn giá giữa các mặt hàng.");
      await exportReportToExcel({ kind: "sku-chi-tiet", mode, range, branchName: branchLabel, sheets: [{ name: "Chi tiết SKU", titleRows: titles, autoFilter: true,
        columnGroups: SKU_COLUMN_GROUPS,
        tablePreferenceKey: mode === "view" ? KEY : undefined,
        columns: columns.map(column => ({ key: String(column.key), label: column.label, width: column.key === "name" ? 36 : 24,
          hideable: column.hideable, decimalPlaces: 4,
          format: ["code", "name", "category", "unit", "lastActivityAt"].includes(String(column.key)) ? undefined : "number" as const })),
        rows: rows.map(row => Object.fromEntries(columns.map(column => [column.key, row[column.key as keyof SkuPerformanceRow]]))), footer: { code: "TỔNG", ...totals, previousRevenue: priorTotals.netRevenue, revenueDifference: totals.netRevenue - priorTotals.netRevenue, previousGrossProfit: priorTotals.grossProfit, grossProfitDifference: totals.grossProfit === null || priorTotals.grossProfit === null ? null : totals.grossProfit - priorTotals.grossProfit, missingCostLines: totals.missing, previousMissingCostLines: priorTotals.missing, soldQty: totals.soldQty ?? "Nhiều ĐVT", returnedQty: totals.returnedQty ?? "Nhiều ĐVT", netQty: totals.netQty ?? "Nhiều ĐVT" },
      }, ...(mode === "full" ? [{ name: "Nhóm hàng", titleRows: titles, autoFilter: true,
        columns: [ { key: "category", label: "Nhóm hàng", width: 30 }, ...[{ key: "skuUnits", label: "SKU/ĐVT" }, { key: "netRevenue", label: "Doanh thu thuần" }, { key: "cogs", label: "Giá vốn" }, { key: "grossProfit", label: "Lãi gộp" }, { key: "margin", label: "Biên lãi (%)" }].map(column => ({ ...column, width: 24, format: "number" as const, decimalPlaces: 4 })) ], rows: categories,
      }] : []), ...reconciliationSheet] });
      toast({ title: "Đã xuất báo cáo SKU", variant: "success" });
    } catch (error) { toast({ title: "Không xuất được Excel", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" }); }
    finally { setExporting(false); }
  }
  return <div className="flex min-h-full flex-col">
    <ReportPageHeader title="Hiệu quả mặt hàng" subtitle={comparisonLabel} preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
      onExportView={() => exportRows("view")} onExportFull={() => exportRows("full")} exportDisabled={pending || exporting || Boolean(error) || metricFilterError(metricFilters) || !rows.length} />
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Tiền hàng bán" value={pending || error ? "—" : money(totals.salesAmount)} hint={pending || error ? "" : reportChange(totals.salesAmount, priorTotals.salesAmount)} />
        <SummaryCard label="Tiền hàng trả" value={pending || error ? "—" : money(totals.returnAmount)} hint={pending || error ? "" : reportChange(totals.returnAmount, priorTotals.returnAmount)} />
        <SummaryCard label="Doanh thu thuần" value={pending || error ? "—" : money(totals.netRevenue)} hint={pending || error ? "" : reportChange(totals.netRevenue, priorTotals.netRevenue)} highlight />
        <SummaryCard label="Lãi gộp" value={pending || error ? "—" : money(totals.grossProfit)} hint={pending || error || totals.grossProfit === null || priorTotals.grossProfit === null ? "" : reportChange(totals.grossProfit, priorTotals.grossProfit)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Input aria-label="Tìm SKU" placeholder="Mã, tên hoặc nhóm hàng" value={search} onChange={event => setSearch(event.target.value)} />
        <SearchableSelect disabled={filtersUnavailable} value={customer || "all"} onValueChange={value => setCustomer(value === "all" ? "" : value)} placeholder="Khách hàng"
          options={[{ value: "all", label: "Tất cả khách hàng" }, ...customers.map(row => ({ value: row.id, label: row.name, meta: row.code })), ...(!filtersUnavailable && customer && !customers.some(row => row.id === customer) ? [{ value: customer, label: "Khách đã chọn · không có phát sinh" }] : [])]} />
        <SearchableSelect disabled={filtersUnavailable} value={item || "all"} onValueChange={value => setItem(value === "all" ? "" : value)} placeholder="Mặt hàng"
          options={[{ value: "all", label: "Tất cả mặt hàng" }, ...itemOptions, ...(!filtersUnavailable && item && !selectedItem ? [{ value: item, label: "Mặt hàng đã chọn · không có phát sinh" }] : [])]} />
        <SearchableSelect disabled={filtersUnavailable} value={category || "all"} onValueChange={value => setCategory(value === "all" ? "" : value)} placeholder="Nhóm hàng" options={options("category")} />
        <SearchableSelect disabled={filtersUnavailable} value={unit || "all"} onValueChange={value => setUnit(value === "all" ? "" : value)} placeholder="Đơn vị tính" options={options("unit")} />
        <select aria-label="Nghiệp vụ cần xem" disabled={filtersUnavailable} className="h-9 min-w-0 rounded border bg-background px-3 text-sm disabled:opacity-50" value={reviewFilter} onChange={event => setReviewFilter(event.target.value as SkuReviewFilter)}>
          {Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {(search || customer || item || category || unit || reviewFilter !== "all" || metricFilters.length > 0) && <button type="button" onClick={resetFilters} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary"><Icon name="filter_alt_off" size={18} />Xóa bộ lọc</button>}
        <Link href={managementReportLink("/phan-tich/bao-cao-tai-chinh", activeBranchId, range)} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary">Kết quả kinh doanh<Icon name="arrow_forward" size={16} /></Link>
      </div>
      {!filtersUnavailable && comparisonRows.length > 0 && customers.length === 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/20">
        <span>Chưa có khách định danh trong kỳ và kỳ đối chiếu.</span>
        <Link href={managementReportLink("/phan-tich/hieu-qua-khach-hang", activeBranchId, range) + "&customerReview=anonymous"} className="inline-flex min-h-9 items-center gap-1 font-medium text-primary">Xem doanh số chưa gắn khách<Icon name="arrow_forward" size={16} /></Link>
      </div>}
      <MetricFilters fields={columns.filter(column => !["code", "name", "category", "unit", "lastActivityAt"].includes(String(column.key))).map(column => ({ key: String(column.key), label: column.label }))} value={metricFilters} onChange={setMetricFilters} />
      <p className="text-xs leading-5 text-muted-foreground">Đơn vị: đồng · Gồm nội bộ · Mỗi size/quy cách là một dòng riêng · Sau chiết khấu, chưa gồm VAT/phí giao · Lãi gộp chưa trừ chi phí vận hành.</p>
      {!pending && !error && unfiltered && <ReportSection title="Đối chiếu doanh thu" tone="primary" actions={<Link className="inline-flex min-h-9 items-center gap-1 text-sm text-primary" href={managementReportLink("/phan-tich/ban-hang", activeBranchId, range) + "&detail=invoices"}>Xem hóa đơn<Icon name="arrow_forward" size={16} /></Link>}>
        {reconciliationError ? <p role="status" className="text-sm text-status-warning">Chưa tải được tổng hóa đơn để đối chiếu.</p> : <ReportDataTable tablePreferenceKey="report.sku-financial.reconciliation" showDisplayOptions={false} rows={reconciliationRows} getRowKey={row => row.metric} columns={[
          { key: "metric", label: "Chỉ tiêu", sticky: true, sortable: false },
          { key: "current", label: "Kỳ này", align: "right", sortable: false, cell: row => money(row.current) },
          { key: "previous", label: "Kỳ trước", align: "right", sortable: false, cell: row => money(row.previous) },
        ]} />}
        {!reconciliationError && <p role={revenueMismatch ? "status" : undefined} className={`mt-2 text-xs leading-5 ${revenueMismatch ? "border-l-2 border-status-warning pl-2 text-foreground" : "text-muted-foreground"}`}>{revenueMismatch ? "Có chênh lệch chưa phân loại. Kiểm tra hóa đơn và dòng hàng; không tự bù số." : "Hai nguồn khớp theo số liệu đã tải."} Cùng phạm vi, gồm nội bộ.</p>}
      </ReportSection>}
      {error && <div role="alert" className="border-l-2 border-destructive p-3 text-sm"><strong>Chưa tải được báo cáo.</strong> {error}<button type="button" onClick={refresh} className="ml-3 text-primary underline">Thử lại</button></div>}
      {!pending && !error && <ReportSection title="Việc cần xem" tone={evidence.missingCount || evidence.lossCount ? "review" : "neutral"}>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {evidence.missingCount > 0 && <button type="button" className="min-h-9 text-foreground underline decoration-status-warning underline-offset-4" onClick={() => setReviewFilter("missing")}>Thiếu giá vốn: {evidence.missingLines} dòng hai kỳ · {evidence.missingCount} SKU/ĐVT</button>}
          {evidence.lossCount > 0 && <button type="button" className="min-h-9 text-destructive underline" onClick={() => setReviewFilter("loss")}>Lãi gộp âm: {evidence.lossCount} SKU/ĐVT · {money(evidence.lossAmount)}</button>}
          {evidence.zeroRevenueCostCount > 0 && <button type="button" className="min-h-9 text-primary underline" onClick={() => setReviewFilter("zeroRevenueCost")}>Giá vốn hàng doanh thu 0: {money(evidence.zeroRevenueCostAmount)} · {evidence.zeroRevenueCostCount} SKU/ĐVT</button>}
          {evidence.declineCount > 0 && <button type="button" className="min-h-9 text-primary underline" onClick={() => setReviewFilter("decline")}>Doanh thu giảm: {evidence.declineCount} SKU/ĐVT · {money(evidence.declineAmount)}</button>}
          {evidence.returnCount > 0 && <button type="button" className="min-h-9 text-primary underline" onClick={() => setReviewFilter("returns")}>Hàng trả: {money(evidence.returnAmount)}</button>}
          {!evidence.missingCount && !evidence.lossCount && !evidence.declineCount && !evidence.returnCount && !evidence.zeroRevenueCostCount && <span>Chưa có biến động cần ưu tiên theo các tiêu chí đang xét.</span>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Đối chiếu giá bán, chiết khấu, hàng trả và giá vốn trước khi điều chỉnh.</p>
        {evidence.zeroRevenueCostCount > 0 && <p className="text-xs text-muted-foreground">Bao bì hoặc hàng tặng có thể không tính phí. Đánh giá cùng hóa đơn, không mặc định là lỗi.</p>}
      </ReportSection>}
      {pending || error ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">{error ? "Chưa tải được dữ liệu." : "Đang tải..."}</p> : <ReportSection title="Chi tiết mặt hàng" subtitle={`${rows.length} dòng SKU/ĐVT · Theo bộ lọc`}><ReportDataTable rows={rows} columns={columns} columnGroups={SKU_COLUMN_GROUPS} className="[&_thead_tr:first-child_th]:text-left [&_thead_tr:first-child_th]:border-r" tablePreferenceKey={KEY} sortState={sort} onSortChange={setSort}
        getRowKey={skuRowKey} subtotalLabel={`${rows.length} dòng SKU/ĐVT`} emptyState="Không có phát sinh phù hợp." /></ReportSection>}
      {!pending && !error && <details className="border-t"><summary className="cursor-pointer border-l-4 border-border bg-muted/50 px-3 py-3 text-base font-semibold">Đóng góp nhóm hàng</summary>
        <ReportDataTable rows={categories} tablePreferenceKey="report.sku-financial.categories" sortState={categorySort} onSortChange={setCategorySort} getRowKey={row => row.category} showDisplayOptions={false} columns={[
          { key: "category", label: "Nhóm hàng", sticky: true }, { key: "skuUnits", label: "SKU/ĐVT", align: "right" },
          { key: "netRevenue", label: "Doanh thu thuần", align: "right", cell: row => money(row.netRevenue) },
          { key: "cogs", label: "Giá vốn", align: "right", cell: row => money(row.cogs) },
          { key: "grossProfit", label: "Lãi gộp", align: "right", cell: row => money(row.grossProfit) },
          { key: "margin", label: "Biên lãi (%)", align: "right", cell: row => row.margin === null ? "—" : formatStockQuantity(row.margin) },
        ]} />
      </details>}
      {updatedAt && !pending && !error && <p className="text-xs text-muted-foreground">Cập nhật {new Date(updatedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}
    </div>
  </div>;
}
