"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { formatChartCurrency, formatCurrency, formatNumber } from "@/lib/format";
import { formatCashBookDate, formatCashTime } from "@/lib/cash-time";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { getAllCashBookEntries } from "@/lib/services/supabase/cash-book";
import { getCashFlowDetailed, type CashFlowDetailedRow } from "@/lib/services/supabase/analytics";
import { getFinanceCashLinks } from "@/lib/services/supabase/management-finance";
import { getCashAccountReport, type CashAccountReport } from "@/lib/services/supabase/cash-account-report";
import { cashFlowMonths, CASH_FLOW_LABELS } from "@/lib/utils/finance-report-reconciliation";
import { cashCapitalRows, cashCapitalView, cashCapitalSortValue, cashCapitalSummary, cashCategoryRows, cashAccountRows, cashAccountSummary, CASH_FIELDS, CASH_GROUPS, CASH_METRICS, CASH_REVIEW_LABELS, EMPTY_CASH_FILTER, ACCOUNT_FIELDS, ACCOUNT_METRICS, type CashCapitalFilter, type CashCapitalRow, type CashAccountRow } from "@/lib/reports/cash-capital";
import { matchesMetricFilters, metricFilterError, metricFilterLabel, parseMetricFilters, type MetricFilter } from "@/lib/reports/metric-filter";
import { sortReportRows } from "@/lib/reports/table-sort";
import { financeReportRangeError } from "@/lib/reports/finance-report-input";
import { exportReportToExcel, buildReportTitleRows, type ExcelSheet } from "@/lib/utils/excel-export";
import { ReportDataTable, ReportPageHeader, type DataTableColumn } from "@/components/shared/report";
import { ReportSection } from "@/components/shared/report/report-section";
import { MetricFilters } from "@/components/shared/report/metric-filters";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Sort = { id: string; direction: "asc" | "desc" };
interface CashWorkspace { rows: CashCapitalRow[]; months: CashFlowDetailedRow[]; accountReport: CashAccountReport | null; accounts: CashAccountRow[]; balances: ReturnType<typeof cashAccountSummary> | null; updatedAt: string; }
const money = (value: number | null) => value === null ? "Chưa đủ dữ liệu" : formatCurrency(value);
const BASIS = "Phiếu hoàn thành theo ngày hạch toán. Thu/chi không đồng nghĩa doanh thu/chi phí. Lũy kế trong kỳ không phải số dư quỹ.";
const selectClass = "h-10 min-w-0 max-w-full rounded border bg-background px-2 text-sm";

export default function LuongTienPage() {
  const { activeBranchId, branchLabel, branches, isReady } = useBranchFilter();
  const { tenant, hasPermission } = useAuth();
  const { toast } = useToast();
  const canViewCashBook = hasPermission(PERMISSIONS.FINANCE_VIEW_CASH_BOOK);
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } = useReportState({ defaultPreset: "thisYear", defaultViewMode: "table" });
  const [data, setData] = useState<CashWorkspace | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CashCapitalFilter>(EMPTY_CASH_FILTER);
  const [sort, setSort] = useState<Sort>({ id: "date", direction: "desc" });
  const [ledgerType, setLedgerType] = useState<"receipt" | "payment">("receipt");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountMetrics, setAccountMetrics] = useState<MetricFilter[]>([]);
  const [accountSort, setAccountSort] = useState<Sort>({ id: "code", direction: "asc" });
  const [monthSort, setMonthSort] = useState<Sort>({ id: "month", direction: "asc" });
  const [activitySort, setActivitySort] = useState<Sort>({ id: "label", direction: "asc" });
  const [categorySort, setCategorySort] = useState<Sort>({ id: "receipt", direction: "desc" });
  const [analysisView, setAnalysisView] = useState("month");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.rows.find(row => row.id === selectedId) ?? null;
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scope = `${tenant?.id}:${activeBranchId ?? "all"}:${range.from}:${range.to}:${canViewCashBook}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const flight = useRef({ scope: "", pending: false, queued: false });
  const branchKey = JSON.stringify((activeBranchId ? [{ id: activeBranchId, name: branchLabel }] : branches).map(branch => ({ id: branch.id, name: branch.name })));
  const refresh = useCallback(() => { if (flight.current.scope === scope && flight.current.pending) flight.current.queued = true; else setRevision(value => value + 1); }, [scope]);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals"], isReady && ready);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const review = query.get("cashReview") ?? "all";
    setFilter({ ...EMPTY_CASH_FILTER, search: query.get("cashSearch") ?? "", account: query.get("cashAccount") ?? "", method: query.get("cashMethod") ?? "", category: query.get("cashCategory") ?? "", activity: query.get("cashActivity") ?? "", review: review in CASH_REVIEW_LABELS ? review as CashCapitalFilter["review"] : "all", metrics: parseMetricFilters(query.get("cashMetrics"), CASH_METRICS.map(field => field.key)) });
    if (query.get("cashType") === "payment") setLedgerType("payment");
    const id = query.get("cashSort"); if (CASH_FIELDS.some(field => field.key === id)) setSort({ id: id!, direction: query.get("cashDirection") === "asc" ? "asc" : "desc" });
    setAccountSearch(query.get("cashAccountSearch") ?? ""); setAccountMetrics(parseMetricFilters(query.get("cashAccountMetrics"), ACCOUNT_METRICS.map(field => field.key)));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const values = { cashSearch: filter.search, cashAccount: filter.account, cashMethod: filter.method, cashCategory: filter.category, cashActivity: filter.activity, cashReview: filter.review, cashMetrics: filter.metrics.length ? JSON.stringify(filter.metrics) : "", cashType: ledgerType, cashSort: sort.id, cashDirection: sort.direction, cashAccountSearch: accountSearch, cashAccountMetrics: accountMetrics.length ? JSON.stringify(accountMetrics) : "" };
    for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history.replaceState(null, "", url);
  }, [ready, filter, sort, ledgerType, accountSearch, accountMetrics]);
  useEffect(() => { setSelectedId(null); }, [scope]);
  useEffect(() => { if (selectedId && data && !data.rows.some(row => row.id === selectedId)) setSelectedId(null); }, [data, selectedId]);
  useEffect(() => {
    if (!ready || !isReady || !tenant?.id) return;
    let active = true;
    setRefreshing(true);
    const request = { scope, pending: true, queued: false }; flight.current = request;
    const run = async () => {
      const dateError = financeReportRangeError(range.from, range.to); if (dateError) throw new Error(dateError);
      if (!canViewCashBook) return { rows: [], months: await getCashFlowDetailed(6, activeBranchId, { from: range.from, to: range.to }), accountReport: null, accounts: [], balances: null, updatedAt: new Date().toISOString() };
      const dateToExclusive = new Date(Date.parse(range.to) + 86_400_000).toISOString().slice(0, 10);
      const [entries, sources, accountReport] = await Promise.all([
        getAllCashBookEntries({ branchId: activeBranchId, dateFrom: range.from, dateToExclusive, statuses: ["completed"] }),
        getFinanceCashLinks(range.from, range.to, activeBranchId),
        getCashAccountReport(JSON.parse(branchKey), range.from, range.to),
      ]);
      const metadata = new Map(accountReport.accounts.map(account => [account.id, account]));
      const enriched = entries.map(entry => ({ ...entry, moneyAccountCode: metadata.get(entry.moneyAccountId ?? "")?.code ?? entry.moneyAccountCode, moneyAccountName: metadata.get(entry.moneyAccountId ?? "")?.name ?? entry.moneyAccountName }));
      const accounts = cashAccountRows(accountReport, enriched);
      return { rows: cashCapitalRows(enriched, sources), months: cashFlowMonths(enriched, range.from, range.to), accounts, accountReport, balances: cashAccountSummary(accounts, accountReport, enriched), updatedAt: new Date().toISOString() };
    };
    run().then(result => { if (active && scopeRef.current === scope) { setData(result); setLoadedScope(scope); setLoadError(null); } }).catch(error => { if (active && scopeRef.current === scope) { setLoadError(error instanceof Error ? error.message : "Không tải được báo cáo dòng tiền"); setLoadedScope(scope); } }).finally(() => { request.pending = false; if (active && scopeRef.current === scope) setRefreshing(false); if (active && request.queued) setRevision(value => value + 1); });
    return () => { active = false; };
  }, [ready, isReady, tenant?.id, scope, activeBranchId, range.from, range.to, canViewCashBook, branchKey, revision]);

  const pending = !ready || !isReady || loadedScope !== scope;
  const unavailable = pending || Boolean(loadError);
  const allRows = data?.rows ?? [];
  const filteredRows = useMemo(() => cashCapitalView(data?.rows ?? [], filter, sort), [data, filter, sort]);
  const ledgerRows = filteredRows.filter(row => row.type === ledgerType);
  const totals = cashCapitalSummary(filteredRows);
  const months = useMemo(() => canViewCashBook ? (financeReportRangeError(range.from, range.to) ? [] : cashFlowMonths(filteredRows, range.from, range.to)) : data?.months ?? [], [filteredRows, data, canViewCashBook, range.from, range.to]);
  const monthRows = sortReportRows(months, row => monthSort.id === "month" ? Number(row.month.split("/")[1]) * 12 + Number(row.month.split("/")[0].slice(1)) : row[monthSort.id as keyof CashFlowDetailedRow], monthSort.direction);
  const activityRows = sortReportRows(Object.entries(CASH_FLOW_LABELS).map(([activity, label]) => ({ activity, label, ...cashCapitalSummary(filteredRows.filter(row => row.activity === activity)) })), row => row[activitySort.id === "activity" ? "label" : activitySort.id as "count" | "receipt" | "payment" | "net"], activitySort.direction);
  const categoryRows = sortReportRows(cashCategoryRows(filteredRows), row => row[categorySort.id as keyof ReturnType<typeof cashCategoryRows>[number]], categorySort.direction);
  const accountRows = useMemo(() => sortReportRows((data?.accounts ?? []).filter(row => [row.code, row.name, row.branchName, row.bank_name, row.account_number].join(" ").toLocaleLowerCase("vi").includes(accountSearch.trim().toLocaleLowerCase("vi")) && matchesMetricFilters(row, accountMetrics)), row => row[accountSort.id as keyof CashAccountRow], accountSort.direction), [data, accountSearch, accountMetrics, accountSort]);
  const summary = canViewCashBook ? totals : { count: 0, receipt: months.reduce((sum, row) => sum + row.totalReceipt, 0), payment: months.reduce((sum, row) => sum + row.totalPayment, 0), net: months.reduce((sum, row) => sum + row.net, 0) };
  const updateFilter = (patch: Partial<CashCapitalFilter>) => setFilter(current => ({ ...current, ...patch }));
  const ledgerColumns: DataTableColumn<CashCapitalRow>[] = CASH_FIELDS.map(field => ({ key: field.key, label: field.label, sticky: field.key === "code", hideable: field.key !== "code", sortable: true, sortValue: row => cashCapitalSortValue(row, field.key) as string | number | null, width: field.key === "note" || field.key === "accountName" ? "240px" : "170px", align: field.key === "receipt" || field.key === "payment" ? "right" : "left", cell: row => field.key === "code" ? <button type="button" className="min-h-9 font-medium text-primary" onClick={() => setSelectedId(row.id)}>{row.code}</button> : field.key === "date" ? formatCashBookDate(row.date) : field.key === "occurredAt" ? formatCashTime(row.occurredAt) : field.key === "receipt" || field.key === "payment" ? money(row[field.key]) : String(row[field.key] || "—"), subtotalCell: field.key === "receipt" || field.key === "payment" ? money(cashCapitalSummary(ledgerRows)[field.key]) : undefined }));
  const accountColumns: DataTableColumn<CashAccountRow>[] = ACCOUNT_FIELDS.map(field => ({ key: field.key, label: field.label, sticky: field.key === "branchName", hideable: field.key !== "branchName", sortable: true, width: "180px", align: ACCOUNT_METRICS.some(metric => metric.key === field.key) ? "right" : "left", cell: row => field.key === "opening_date" ? row.opening_date ? formatCashBookDate(row.opening_date) : "Chưa thiết lập" : ACCOUNT_METRICS.some(metric => metric.key === field.key) ? money(row[field.key] as number | null) : String(row[field.key] ?? "—") }));
  const monthColumns: DataTableColumn<CashFlowDetailedRow>[] = [{ key: "month", label: "Tháng", sticky: true, hideable: false, sortValue: row => Number(row.month.split("/")[1]) * 12 + Number(row.month.split("/")[0].slice(1)) }, ...[{ key: "totalReceipt", label: "Thu" }, { key: "totalPayment", label: "Chi" }, { key: "net", label: "Ròng" }, { key: "cumulativeBalance", label: "Lũy kế trong kỳ" }].map(field => ({ ...field, align: "right" as const, cell: (row: CashFlowDetailedRow) => money(row[field.key as "net"]) }))];
  const categoryColumns: DataTableColumn<typeof categoryRows[number]>[] = [{ key: "category", label: "Khoản mục", sticky: true, hideable: false }, { key: "categoryCode", label: "Mã khoản mục" }, { key: "activityLabel", label: "Hoạt động" }, { key: "recognitionLabel", label: "Nhóm ghi nhận" }, ...[{ key: "count", label: "Số phiếu" }, { key: "receipt", label: "Thu" }, { key: "payment", label: "Chi" }, { key: "net", label: "Ròng" }].map(field => ({ ...field, align: "right" as const, cell: (row: typeof categoryRows[number]) => field.key === "count" ? formatNumber(row.count) : money(row[field.key as "net"]) }))];
  const invalid = metricFilterError(filter.metrics) || metricFilterError(accountMetrics);
  const handleExport = async (mode: "view" | "full") => {
    if (unavailable || refreshing || exporting || invalid || !data) return;
    setExporting(true);
    try {
      const titleRows = [...buildReportTitleRows({ title: "THU CHI VÀ DÒNG TIỀN", range, branchName: branchLabel, tenantName: tenant?.name }), BASIS,
        `Tìm: ${filter.search || "Tất cả"}; tài khoản: ${filter.account === "unassigned" ? "Chưa gắn tài khoản" : data.accounts.find(account => account.id === filter.account)?.name ?? (filter.account || "Tất cả")}; khoản mục: ${filter.category || "Tất cả"}; phương thức: ${allRows.find(row => row.paymentMethod === filter.method)?.methodLabel ?? "Tất cả"}`,
        `Hoạt động: ${CASH_FLOW_LABELS[filter.activity as keyof typeof CASH_FLOW_LABELS] ?? "Tất cả"}; ${CASH_REVIEW_LABELS[filter.review]}; ${metricFilterLabel(filter.metrics, CASH_METRICS)}`,
        `Sắp xếp chứng từ: ${CASH_FIELDS.find(field => field.key === sort.id)?.label} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}; lọc tài khoản: ${accountSearch || "Tất cả"}; ${metricFilterLabel(accountMetrics, ACCOUNT_METRICS)}`];
      const sheets: ExcelSheet[] = mode === "full" || !canViewCashBook || analysisView === "month" || viewMode === "chart" ? [{ name: "Thu chi theo tháng", titleRows, ...(mode === "view" ? { tablePreferenceKey: "report.cash-flow.months" } : {}), columns: monthColumns.map(field => ({ key: String(field.key), label: field.label, format: field.key === "month" ? "text" : "number", decimalPlaces: 2, width: 25 })), rows: monthRows.map(row => ({ ...row })), footer: { month: "TỔNG KỲ", totalReceipt: summary.receipt, totalPayment: summary.payment, net: summary.net } }] : [];
      if (canViewCashBook) {
        if (mode === "full" || analysisView === "activity") sheets.push({ name: "Hoạt động dòng tiền", titleRows, ...(mode === "view" ? { tablePreferenceKey: "report.cash-flow.activities" } : {}), columns: [{ key: "label", label: "Hoạt động", width: 30 }, ...["count", "receipt", "payment", "net"].map((key, index) => ({ key, label: ["Số phiếu", "Thu", "Chi", "Ròng"][index], format: "number" as const, decimalPlaces: key === "count" ? 0 : 2, width: 22 }))], rows: activityRows });
        if (mode === "full" || analysisView === "category") sheets.push({ name: "Thu chi theo khoản mục", titleRows, ...(mode === "view" ? { tablePreferenceKey: "report.cash-flow.categories" } : {}), columns: categoryColumns.map(field => ({ key: String(field.key), label: field.label, width: 28, format: ["count", "receipt", "payment", "net"].includes(String(field.key)) ? "number" : "text", decimalPlaces: field.key === "count" ? 0 : 2 })), rows: categoryRows });
        sheets.push({ name: "Quỹ và tài khoản", titleRows: [...titleRows, "Số dư và phát sinh tài khoản theo toàn kỳ/chi nhánh, không áp bộ lọc phát sinh.", `Sắp xếp tài khoản: ${ACCOUNT_FIELDS.find(field => field.key === accountSort.id)?.label} ${accountSort.direction === "asc" ? "tăng dần" : "giảm dần"}`, ...(data.accountReport?.failures.map(failure => `Chưa tải: ${failure.branchName}`) ?? [])], ...(mode === "view" ? { tablePreferenceKey: "report.cash-flow.accounts" } : {}), columns: ACCOUNT_FIELDS.map(field => ({ key: field.key, label: field.label, width: 25, format: ACCOUNT_METRICS.some(metric => metric.key === field.key) ? "number" : "text", decimalPlaces: 2 })), rows: accountRows.map(row => ({ ...row, opening_date: row.opening_date ? formatCashBookDate(row.opening_date) : "Chưa thiết lập" })) });
        for (const type of mode === "full" ? ["receipt", "payment"] as const : [ledgerType]) sheets.push({ name: type === "receipt" ? "Phiếu thu" : "Phiếu chi", titleRows, columnGroups: CASH_GROUPS, ...(mode === "view" ? { tablePreferenceKey: `report.cash-flow.${type}` } : {}), columns: CASH_FIELDS.map(field => ({ key: field.key, label: field.label, hideable: field.key !== "code", width: field.key === "note" ? 40 : 24, format: field.key === "receipt" || field.key === "payment" ? "number" : "text", decimalPlaces: 2 })), rows: filteredRows.filter(row => row.type === type).map(row => ({ ...row, date: formatCashBookDate(row.date), occurredAt: formatCashTime(row.occurredAt) })), footer: { code: "TỔNG", ...cashCapitalSummary(filteredRows.filter(row => row.type === type)) } });
      }
      await exportReportToExcel({ kind: "luong-tien", mode, range, branchName: branchLabel, tenantName: tenant?.name, sheets });
      toast({ title: "Đã xuất báo cáo dòng tiền", variant: "success" });
    } catch (error) { toast({ title: "Không xuất được báo cáo", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" }); }
    finally { setExporting(false); }
  };

  return <div className="min-w-0 space-y-4 p-3 md:p-5">
    <ReportPageHeader title="Thu chi và dòng tiền" subtitle="Từ tổng phát sinh đến quỹ, tài khoản và chứng từ" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange} viewMode={viewMode} onViewModeChange={setViewMode} onExportView={() => handleExport("view")} onExportFull={() => handleExport("full")} exportDisabled={unavailable || refreshing || exporting || invalid} actions={<button type="button" aria-label="Làm mới dòng tiền" title="Làm mới dòng tiền" disabled={refreshing || pending} onClick={refresh} className="flex size-9 items-center justify-center rounded border bg-background disabled:opacity-40"><Icon name="refresh" size={18} className={refreshing ? "animate-spin" : ""} /></button>} />
    <p className="text-xs leading-5 text-muted-foreground">{BASIS}{!activeBranchId && " Tổng thu/chi các chi nhánh, chưa loại luân chuyển nội bộ."}</p>
    {pending ? <p role="status" className="py-12 text-center">Đang tải dòng tiền...</p> : loadError ? <div role="alert" className="border-y border-destructive/40 py-6 text-destructive"><p>{loadError}</p><button type="button" className="mt-2 min-h-10 underline" onClick={refresh}>Tải lại</button></div> : <>
      {canViewCashBook && <section aria-label="Lọc phát sinh" className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_minmax(200px,1fr)_auto]">
          <Input aria-label="Tìm chứng từ thu chi" placeholder="Mã, đối tượng, nội dung, nguồn" value={filter.search} onChange={event => updateFilter({ search: event.target.value })} />
          <select aria-label="Quỹ hoặc tài khoản" className={selectClass} value={filter.account} onChange={event => updateFilter({ account: event.target.value })}><option value="">Tất cả tài khoản</option><option value="unassigned">Chưa gắn tài khoản</option>{(data?.accounts ?? []).map(account => <option key={account.id} value={account.id}>{account.branchName} · {account.code} · {account.name}</option>)}</select>
          <button type="button" className="min-h-10 text-left text-sm text-primary" onClick={() => setFilter(EMPTY_CASH_FILTER)}>Xóa bộ lọc phát sinh</button>
        </div>
        <details className="border-y py-2"><summary className="min-h-7 cursor-pointer text-sm font-medium">Bộ lọc phát sinh ({[filter.search, filter.account, filter.method, filter.category, filter.activity, filter.review === "all" ? "" : filter.review].filter(Boolean).length + filter.metrics.length})</summary><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select aria-label="Khoản mục dòng tiền" className={selectClass} value={filter.category} onChange={event => updateFilter({ category: event.target.value })}><option value="">Tất cả khoản mục</option>{[...new Set(allRows.map(row => row.category))].sort((a, b) => a.localeCompare(b, "vi")).map(label => <option key={label} value={label}>{label}</option>)}</select>
          <select aria-label="Phương thức dòng tiền" className={selectClass} value={filter.method} onChange={event => updateFilter({ method: event.target.value })}><option value="">Tất cả phương thức</option>{[...new Map(allRows.map(row => [row.paymentMethod ?? "", row.methodLabel])).entries()].filter(([key]) => key).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="Hoạt động dòng tiền" className={selectClass} value={filter.activity} onChange={event => updateFilter({ activity: event.target.value })}><option value="">Tất cả hoạt động</option>{Object.entries(CASH_FLOW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="Kiểm tra dòng tiền" className={selectClass} value={filter.review} onChange={event => updateFilter({ review: event.target.value as CashCapitalFilter["review"] })}>{Object.entries(CASH_REVIEW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </div>
        <MetricFilters fields={CASH_METRICS} value={filter.metrics} onChange={metrics => updateFilter({ metrics })} />
        </details>
      </section>}
      {invalid && <p role="alert" className="text-sm text-destructive">Khoảng lọc phát sinh hoặc tài khoản chưa hợp lệ.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{ label: "Thu trong kỳ", value: summary.receipt }, { label: "Chi trong kỳ", value: summary.payment }, { label: "Dòng tiền ròng", value: summary.net }, ...(canViewCashBook ? [{ label: "Số dư cuối kỳ toàn phạm vi", value: data?.balances?.closing ?? null }] : [])].map(item => <div key={item.label} className="min-w-0 border-l-2 border-primary/30 py-2 pl-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className="break-words text-lg font-semibold tabular-nums">{money(item.value)}{item.value !== null && " đ"}</p><p className="text-xs text-muted-foreground">{item.label.startsWith("Số dư") ? "Không áp bộ lọc phát sinh" : canViewCashBook ? "Theo bộ lọc phát sinh" : "Theo kỳ và phạm vi"}</p></div>)}</div>
      {canViewCashBook && <ReportSection title="Cần kiểm tra" tone="review" subtitle="Toàn kỳ và phạm vi chi nhánh.">
        <div className="grid gap-3 sm:grid-cols-3">
          {([{ review: "unassigned", label: "Chưa gắn tài khoản", note: "Đối chiếu quỹ hoặc ngân hàng của từng phiếu." }, { review: "unclassified", label: "Chưa phân loại hoạt động", note: "Kiểm tra khoản mục và nguồn ghi nhận, không đoán loại dòng tiền." }, { review: "untimed", label: "Chưa rõ giờ thu/chi", note: "Phân biệt ngày hạch toán với thời điểm thực nhận, thực trả." }] as const).map(item => {
            const matches = allRows.filter(row => item.review === "unassigned" ? !row.moneyAccountId : item.review === "untimed" ? !row.occurredAt : row.activity === "unclassified");
            return <div key={item.review} className="min-w-0 border-l pl-3">
              <p className="font-medium">{item.label} · {formatNumber(matches.length)}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>
              <button type="button" aria-label={`Xem phiếu ${item.label.toLocaleLowerCase("vi")}`} className="min-h-10 text-sm text-primary disabled:opacity-40" disabled={!matches.length} onClick={() => { setFilter({ ...EMPTY_CASH_FILTER, review: item.review }); setLedgerType(matches[0]?.type ?? "receipt"); }}>Xem phiếu</button>
            </div>;
          })}
        </div>
      </ReportSection>}
      {viewMode === "chart" && <ReportSection title="Thu và chi theo tháng"><ResponsiveContainer width="100%" height={280} minWidth={0} initialDimension={{ width: 320, height: 224 }}><BarChart data={months}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis tickFormatter={formatChartCurrency} width={75} /><Tooltip formatter={value => formatCurrency(Number(value))} /><Legend /><Bar dataKey="totalReceipt" name="Thu" fill="#15803d" /><Bar dataKey="totalPayment" name="Chi" fill="#be123c" /></BarChart></ResponsiveContainer></ReportSection>}
      <ReportSection title="Phân tích phát sinh" tone="primary" subtitle="Lũy kế theo thứ tự thời gian; nhóm ghi nhận chỉ phản ánh phiếu đã liên kết, không thay thế báo cáo KQKD.">
        {canViewCashBook && <Tabs value={analysisView} onValueChange={setAnalysisView}><TabsList className="mb-3"><TabsTrigger value="month">Theo tháng</TabsTrigger><TabsTrigger value="activity">Hoạt động</TabsTrigger><TabsTrigger value="category">Khoản mục</TabsTrigger></TabsList></Tabs>}
        {(analysisView === "month" || !canViewCashBook) && <ReportDataTable tablePreferenceKey="report.cash-flow.months" columns={monthColumns} rows={monthRows} getRowKey={row => row.month} sortState={monthSort} onSortChange={setMonthSort} />}
        {analysisView === "activity" && canViewCashBook && <ReportDataTable tablePreferenceKey="report.cash-flow.activities" columns={[{ key: "label", label: "Hoạt động", sticky: true, hideable: false, cell: row => <button type="button" className="min-h-9 text-left text-primary" onClick={() => updateFilter({ activity: row.activity })}>{row.label}</button> }, ...[{ key: "count", label: "Số phiếu" }, { key: "receipt", label: "Thu" }, { key: "payment", label: "Chi" }, { key: "net", label: "Ròng" }].map(field => ({ ...field, align: "right" as const, cell: (row: typeof activityRows[number]) => field.key === "count" ? formatNumber(row.count) : money(row[field.key as "net"]) }))]} rows={activityRows} getRowKey={row => row.activity} sortState={activitySort} onSortChange={setActivitySort} />}
        {analysisView === "category" && canViewCashBook && <ReportDataTable tablePreferenceKey="report.cash-flow.categories" columns={categoryColumns} rows={categoryRows} getRowKey={row => row.id} sortState={categorySort} onSortChange={setCategorySort} />}
      </ReportSection>
      {canViewCashBook && <>
        <ReportSection title="Quỹ và tài khoản" tone="primary" subtitle="Số dư và phát sinh toàn kỳ/chi nhánh, không áp bộ lọc phát sinh." actions={<Link className="text-sm text-primary" href="/cai-dat/tai-khoan-tien">Thiết lập tài khoản</Link>}>
          <p className="mb-3 text-sm">Đầu kỳ: <strong>{money(data?.balances?.opening ?? null)}</strong> · Cuối kỳ: <strong>{money(data?.balances?.closing ?? null)}</strong></p>
          {data?.balances?.incomplete && <div role="alert" className="mb-3 border-l-2 border-status-warning pl-3 text-sm">Chưa kết luận số dư toàn phạm vi: {data.balances.missingAccount} phiếu chưa đối chiếu tài khoản; {data.balances.missingOpening} tài khoản chưa đủ số dư gốc; {data.balances.mismatches} tài khoản lệch đối chiếu.{data.accounts.length === 0 && <p>Chưa có sổ tài khoản đủ dữ liệu trong phạm vi này.</p>}{data.balances.sourceCountDifference !== 0 && <p>Nguồn tài khoản và danh sách phiếu chưa đồng bộ; cần tải lại.</p>}{data.accountReport?.failures.map(failure => <p key={failure.branchId}>{failure.branchName}: {failure.message}</p>)}</div>}
          <div className="flex flex-wrap gap-2"><Input aria-label="Tìm tài khoản tiền" placeholder="Chi nhánh, mã, tên, số tài khoản" value={accountSearch} onChange={event => setAccountSearch(event.target.value)} className="max-w-lg" /><button type="button" className="min-h-10 text-sm text-primary" onClick={() => { setAccountSearch(""); setAccountMetrics([]); }}>Xóa bộ lọc tài khoản</button></div>
          <MetricFilters fields={ACCOUNT_METRICS} value={accountMetrics} onChange={setAccountMetrics} />
          <ReportDataTable tablePreferenceKey="report.cash-flow.accounts" columns={accountColumns} rows={accountRows} getRowKey={row => row.id} sortState={accountSort} onSortChange={setAccountSort} subtotalLabel={`${accountRows.length} tài khoản theo bộ lọc tài khoản`} />
        </ReportSection>
        <ReportSection title="Chứng từ dòng tiền" tone="primary" subtitle="Tách phiếu thu và phiếu chi; mở mã phiếu để xem đầy đủ nội dung và nguồn.">
          <Tabs value={ledgerType} onValueChange={value => setLedgerType(value as "receipt" | "payment")}><TabsList><TabsTrigger value="receipt">Phiếu thu ({filteredRows.filter(row => row.type === "receipt").length})</TabsTrigger><TabsTrigger value="payment">Phiếu chi ({filteredRows.filter(row => row.type === "payment").length})</TabsTrigger></TabsList></Tabs>
          <ReportDataTable tablePreferenceKey={`report.cash-flow.${ledgerType}`} columns={ledgerColumns} columnGroups={CASH_GROUPS} rows={ledgerRows} getRowKey={row => row.id} sortState={sort} onSortChange={setSort} subtotalLabel={`${ledgerRows.length} phiếu theo bộ lọc`} className="[&_thead_tr:first-child_th]:border-r [&_thead_tr:first-child_th]:text-left" />
        </ReportSection>
      </>}
      <p className="text-xs text-muted-foreground">Cập nhật: {data ? formatCashTime(data.updatedAt) : "—"}. Báo cáo quản trị nội bộ, không thay thế báo cáo lưu chuyển tiền tệ theo chế độ kế toán.</p>
    </>}
    <Dialog open={Boolean(selected) && !unavailable} onOpenChange={open => { if (!open) setSelectedId(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{selected?.typeLabel === "Thu" ? "Phiếu thu" : "Phiếu chi"} {selected?.code}</DialogTitle></DialogHeader>{selected && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm">{CASH_FIELDS.filter(field => field.key !== "code" && field.key !== "typeLabel" && field.key !== (selected.type === "receipt" ? "payment" : "receipt")).map(field => <div key={field.key} className="contents"><dt className="text-muted-foreground">{field.key === "receipt" || field.key === "payment" ? "Số tiền" : field.label}</dt><dd className="min-w-0 break-words">{field.key === "date" ? formatCashBookDate(selected.date) : field.key === "occurredAt" ? formatCashTime(selected.occurredAt) : field.key === "receipt" || field.key === "payment" ? money(selected[field.key]) : String(selected[field.key] || "—")}</dd></div>)}</dl>}</DialogContent></Dialog>
  </div>;
}
