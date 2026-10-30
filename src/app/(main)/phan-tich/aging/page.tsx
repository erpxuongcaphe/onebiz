"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Icon } from "@/components/ui/icon";
import { SummaryCard } from "@/components/shared/summary-card";
import { ReportPageHeader, ReportDataTable, type DataTableColumn } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { exportReportToExcel, buildInfoSheet, type ExcelSheet } from "@/lib/utils/excel-export";
import { formatNumber, formatCurrency, formatUnitPrice, formatDate, formatDateInputValue } from "@/lib/format";
import { getInventoryAgingReport, type InventoryAgingReport } from "@/lib/services";
import { agingView, agingTotals, agingBuckets, agingSheet, AGING_LABELS, type AgingFilter, type AgingViewRow } from "@/lib/reports/inventory-aging-view";

const COLORS = ["#059669", "#0284c7", "#d97706", "#e11d48", "#64748b"];
const money = (value: number | null) => value === null ? "Chưa xác định" : formatCurrency(value);
const PERMISSIONS = ["reports.analytics", "reports.view_detail", "products.view_cost"];

export default function AgingReportPage() {
  const { user, tenant, permissions, hasPermission, isLoading } = useAuth();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } = useReportState({ defaultViewMode: "table" });
  const allowed = !isLoading && PERMISSIONS.every(hasPermission);
  const [report, setReport] = useState<InventoryAgingReport | null>(null), [loadedScope, setLoadedScope] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(""), [unit, setUnit] = useState(""), [filter, setFilter] = useState<AgingFilter>("all");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>({ id: "daysInStock", direction: "desc" });
  const [chartMetric, setChartMetric] = useState<"count" | "value">("count");
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState<string | null>(null);
  const scope = JSON.stringify([tenant?.id, user?.id, [...permissions ?? []].sort(), activeBranchId, allowed]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const pending = !isReady || loading || loadedScope !== scope;
  const source = useMemo(() => allowed && !pending && !error ? report?.rows ?? [] : [], [allowed, pending, error, report]);
  const rows = useMemo(() => agingView(source, search, unit, filter, sort), [source, search, unit, filter, sort]);
  const totals = useMemo(() => agingTotals(rows), [rows]);
  const reviewRows = useMemo(() => rows.filter(row => row.needsReview), [rows]);
  const reviewTotals = useMemo(() => agingTotals(reviewRows), [reviewRows]);
  const buckets = useMemo(() => agingBuckets(rows), [rows]);
  const chartHasValues = chartMetric === "count" ? rows.length > 0 : buckets.some(bucket => bucket.count > 0 && bucket.value !== null);
  const requestIdRef = useRef(0);
  const exportKey = JSON.stringify([scope, loadedScope, search, unit, filter, sort, revision, loading, error]);
  const exportKeyRef = useRef(exportKey); exportKeyRef.current = exportKey;

  useEffect(() => {
    const request = ++requestIdRef.current; let cancelled = false;
    if (!allowed || !isReady || !tenant?.id) return;
    setLoading(true); setError(null);
    getInventoryAgingReport({ branchId: activeBranchId ?? null }).then(result => {
      if (cancelled || request !== requestIdRef.current || scopeRef.current !== scope) return;
      setReport(result); setLoadedScope(scope);
    }).catch(reason => {
      if (cancelled || request !== requestIdRef.current || scopeRef.current !== scope) return;
      setReport(null); setLoadedScope(scope); setError(reason instanceof Error ? reason.message : "Không tải được báo cáo.");
    }).finally(() => { if (!cancelled && request === requestIdRef.current && scopeRef.current === scope) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, isReady, tenant?.id, activeBranchId, scope, revision]);

  const unitOptions = useMemo(() => [...new Set([...source.map(row => row.catalogUnit || "Chưa có ĐVT"), ...(unit ? [unit] : [])])]
    .sort((a, b) => a.localeCompare(b, "vi")).map(value => ({ value, label: value })), [source, unit]);
  const columns: DataTableColumn<AgingViewRow>[] = [
    { key: "code", label: "Mã hàng", width: "140px", hideable: false }, { key: "name", label: "Mặt hàng", width: "260px" },
    { key: "unitLabel", label: "ĐVT hiện tại", width: "120px" }, { key: "conversionLabel", label: "Quy đổi hiện tại", width: "260px" },
    { key: "currentQty", label: "Tồn hiện tại", align: "right", cell: row => formatNumber(row.currentQty), subtotalCell: "Không cộng khác ĐVT" },
    { key: "costPrice", label: "Giá danh mục / ĐVT", align: "right", cell: row => row.costPrice === null ? "Chưa xác định" : formatUnitPrice(row.costPrice) },
    { key: "stockValue", label: "Giá trị tham chiếu", align: "right", cell: row => money(row.stockValue), subtotalCell: money(totals.missingValues ? null : totals.knownValue) },
    { key: "lastInDate", label: "Nhập cuối", cell: row => row.lastInDate ? formatDate(row.lastInDate) : "Chưa có dữ liệu" },
    { key: "daysInStock", label: "Ngày từ nhập cuối", align: "right", cell: row => row.daysInStock === null ? "Chưa xác định" : formatNumber(row.daysInStock) },
    { key: "lastSaleDate", label: "Bán cuối", cell: row => row.lastSaleDate ? formatDate(row.lastSaleDate) : "Chưa có dữ liệu" },
    { key: "daysSinceLastSale", label: "Ngày từ bán cuối", align: "right", cell: row => row.daysSinceLastSale === null ? "Chưa xác định" : formatNumber(row.daysSinceLastSale) },
    { key: "agingBucket", label: "Nhóm từ nhập cuối", cell: row => AGING_LABELS[row.agingBucket] },
    { key: "reviewStatus", label: "Rà soát", cell: row => <span className={row.needsReview ? "font-medium text-amber-700" : row.insufficientHistory ? "text-rose-700" : "text-muted-foreground"}>{row.reviewStatus}</span> },
  ];

  const handleExport = useCallback(async (mode: "view" | "full") => {
    if (!allowed || pending || error || exporting || !rows.length || !report || !hasPermission(mode === "full" ? "reports.export_detail" : "reports.export")) return;
    const key = exportKeyRef.current; setExporting(true); setExportError(null);
    try {
      const date = formatDateInputValue(report.generatedAt), snapshotRange = { from: date, to: date };
      const info = buildInfoSheet({ title: "LUÂN CHUYỂN TỒN KHO", range: snapshotRange, branchName: branchLabel, generatedAt: new Date(report.generatedAt),
        description: `Tìm: ${search || "Tất cả"}; ĐVT: ${unit || "Tất cả"}; Nhóm: ${filter}; Sắp xếp: ${sort?.id || "Nguồn"} ${sort?.direction || ""}`,
        disclaimer: "Ảnh chụp tồn dương theo nguồn hiện hành. Giá trị = tồn × giá danh mục hiện tại, không phải định giá lịch sử. Ngày từ lần nhập cuối không phải tuổi lớp hàng còn tồn. Không có lịch sử bán không đồng nghĩa chưa từng bán. NVL cần đối chiếu xuất dùng/BOM, không kết luận chậm sử dụng từ lịch sử bán. Quy đổi hiện tại chỉ tham khảo." });
      const detail = agingSheet(rows);
      if (mode === "full") delete detail.tablePreferenceKey;
      const sheets: ExcelSheet[] = [info];
      if (mode === "full") sheets.push({ name: "Theo nhập cuối", columns: [
        { key: "label", label: "Nhóm từ nhập cuối", width: 26 }, { key: "count", label: "Số mặt hàng", width: 18, format: "number" },
        { key: "value", label: "Giá trị tham chiếu", width: 24, format: "currency" }, { key: "missingValues", label: "Mã thiếu giá trị", width: 20, format: "number" },
      ], rows: buckets.map(bucket => ({ ...bucket })), footer: { label: "TỔNG", count: totals.count, value: totals.missingValues ? null : totals.knownValue, missingValues: totals.missingValues } });
      sheets.push(detail);
      if (mode === "full") { const review = agingSheet(reviewRows, "Cần rà soát"); delete review.tablePreferenceKey; sheets.push(review); }
      await exportReportToExcel({ kind: "aging", mode, range: snapshotRange, branchName: branchLabel, sheets, shouldSave: () => exportKeyRef.current === key });
      if (exportKeyRef.current === key) toast({ title: "Đã xuất báo cáo", description: `${rows.length} mặt hàng theo bộ lọc`, variant: "success" });
    } catch (reason) { if (exportKeyRef.current === key) setExportError(reason instanceof Error ? reason.message : "Không xuất được Excel."); }
    finally { setExporting(false); }
  }, [allowed, pending, error, exporting, rows, report, hasPermission, branchLabel, search, unit, filter, sort, buckets, totals, reviewRows, toast]);

  if (isLoading) return <p role="status" className="p-6">Đang xác thực quyền báo cáo...</p>;
  if (!allowed) return <p role="alert" className="p-6">Chưa được cấp quyền xem phân tích chi tiết và giá vốn tồn kho.</p>;
  const unavailable = pending || !!error;
  return <div className="min-h-full space-y-4 p-3 md:p-5">
    <ReportPageHeader title="Luân chuyển tồn kho" subtitle="Tồn hiện tại · Theo lần nhập cuối · Giá trị tham chiếu"
      preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange} hideDateRange
      viewMode={viewMode} onViewModeChange={setViewMode}
      onExportView={hasPermission("reports.export") ? () => handleExport("view") : undefined}
      onExportFull={hasPermission("reports.export_detail") ? () => handleExport("full") : undefined}
      exportDisabled={unavailable || exporting || !rows.length} />
    <div className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
      <p>Giá trị tham chiếu = tồn × giá danh mục hiện tại.</p>
      <details className="mt-1"><summary className="cursor-pointer font-medium">Cơ sở số liệu</summary><p className="mt-2">Số ngày tính từ lần nhập cuối, không phải tuổi các lớp hàng còn tồn. Chỉ gồm tồn dương theo nguồn hiện hành. Nhóm cần rà soát: không ghi nhận bán trên 60 ngày; mã chưa có lịch sử bán chỉ đưa vào khi lần nhập cuối đã quá 60 ngày. Thiếu cả lịch sử nhập và bán được tách riêng, không kết luận là hàng chết. Với NVL, cần đối chiếu thêm xuất dùng/BOM; lịch sử bán không phản ánh đầy đủ sử dụng.</p></details>
      {!unavailable && report && <p className="mt-1 text-xs">Ghi nhận: {formatDate(report.generatedAt)} · Giờ Việt Nam</p>}
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryCard label="Giá trị tham chiếu" value={unavailable ? "—" : money(totals.missingValues ? null : totals.knownValue)} hint={`${totals.missingValues} mã thiếu giá trị`} className="border-l-sky-500 bg-sky-50/60" />
      <SummaryCard label="Mặt hàng" value={unavailable ? "—" : String(totals.count)} hint="Theo bộ lọc" className="border-l-emerald-500 bg-emerald-50/60" />
      <SummaryCard label="Cần rà soát" value={unavailable ? "—" : String(reviewRows.length)} hint="Chưa có bán >60 ngày" className="border-l-amber-500 bg-amber-50/60" />
      <SummaryCard label="Thiếu lịch sử" value={unavailable ? "—" : String(rows.filter(row => row.insufficientHistory).length)} hint="Chưa đủ căn cứ kết luận" className="border-l-rose-400 bg-rose-50/60" />
    </div>
    {error ? <div role="alert" className="space-y-2"><p>{error}</p><Button onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} />Thử lại</Button></div> : <>
      <div className="flex flex-wrap gap-3">
        <Input aria-label="Tìm mặt hàng" placeholder="Mã hoặc tên mặt hàng" value={search} onChange={event => setSearch(event.target.value)} className="min-w-48 flex-1" />
        <SearchableSelect aria-label="ĐVT hiện tại" placeholder="Tất cả ĐVT" options={[{ value: "", label: "Tất cả ĐVT" }, ...unitOptions]} value={unit} onValueChange={setUnit} className="w-48" />
        <SearchableSelect aria-label="Nhóm rà soát" placeholder="Tất cả nhóm" value={filter} onValueChange={value => setFilter(value as AgingFilter)} className="w-56" options={[
          { value: "all", label: "Tất cả nhóm" }, ...Object.entries(AGING_LABELS).map(([value, label]) => ({ value, label })),
          { value: "review", label: "Cần rà soát" }, { value: "insufficient", label: "Thiếu lịch sử" },
        ]} />
        <Button variant="outline" onClick={() => setRevision(value => value + 1)} disabled={pending} title="Tải lại ảnh chụp tồn kho"><Icon name="refresh" size={16} />Tải lại</Button>
      </div>
      {pending && <p role="status">Đang tải báo cáo...</p>}
      {viewMode === "chart" && !pending && <section className="space-y-3 border-y border-border py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Phân bổ theo lần nhập cuối</h2><div role="group" aria-label="Chỉ tiêu biểu đồ" className="flex gap-1">
          <Button variant={chartMetric === "count" ? "default" : "outline"} onClick={() => setChartMetric("count")}>Mặt hàng</Button>
          <Button variant={chartMetric === "value" ? "default" : "outline"} onClick={() => setChartMetric("value")}>Giá trị tham chiếu</Button>
        </div></div>
        {chartHasValues ? <div className="h-72 min-w-0"><ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={buckets} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" fontSize={11} tickFormatter={value => value === AGING_LABELS.unknown ? "Chưa rõ" : String(value).replace(" ngày", "")} /><YAxis fontSize={11} allowDecimals={chartMetric === "value"} tickFormatter={value => chartMetric === "count" ? formatNumber(value) : Math.abs(value) >= 1000000 ? `${formatNumber(value / 1000000)}tr` : Math.abs(value) >= 1000 ? `${formatNumber(value / 1000)}k` : formatNumber(value)} />
            <Tooltip formatter={value => chartMetric === "count" ? `${formatNumber(Number(value))} mặt hàng` : money(value == null ? null : Number(value))} />
            <Bar dataKey={chartMetric} radius={[4, 4, 0, 0]}>{buckets.map((bucket, index) => <Cell key={bucket.key} fill={COLORS[index]} />)}</Bar>
          </BarChart>
        </ResponsiveContainer></div> : <p role="status" className="border-y border-dashed py-10 text-center text-sm text-muted-foreground">{rows.length ? "Chưa đủ giá trị để phân bổ. Xem số mặt hàng hoặc đối chiếu nguồn giá." : "Không có mặt hàng theo bộ lọc."}</p>}
        {chartMetric === "value" && <p className="text-xs text-muted-foreground">Đơn vị: VND · k = nghìn, tr = triệu · {totals.missingValues} mã chưa đủ giá trị tham chiếu</p>}
      </section>}
      <ReportDataTable columns={columns} rows={rows} sortState={sort} onSortChange={setSort} tablePreferenceKey="report.aging.products" getRowKey={row => row.productId}
        subtotalLabel={`${rows.length} mặt hàng`} emptyState={pending ? "Đang tải..." : "Không có mặt hàng phù hợp."} />
      {!pending && reviewRows.length > 0 && <p className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{reviewRows.length} mã cần kiểm tra nhu cầu sử dụng, lịch sử bán và kế hoạch mua tiếp. Giá trị tham chiếu: {money(reviewTotals.missingValues ? null : reviewTotals.knownValue)}. Không mặc định là khoản lỗ.</p>}
    </>}
    {exportError && <p role="alert">{exportError}</p>}
  </div>;
}
