"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { searchOptions } from "@/lib/search-options";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";
import { getAbcReport } from "@/lib/services/supabase/abc-analysis";
import type { AbcRow, AbcReportResult } from "@/lib/services/supabase/abc-analysis";
import { cn } from "@/lib/utils";
import { sortedReportView } from "@/lib/reports/table-sort";
import { SummaryCard } from "@/components/shared/summary-card";

type FilterMode = "all" | "A" | "B" | "C" | "slow";

const FILTER_OPTIONS: { key: FilterMode; label: string; bg: string; icon: string }[] = [
  { key: "all", label: "Tất cả", bg: "bg-surface-container-low", icon: "category" },
  { key: "A", label: "Nhóm A", bg: "bg-status-success/10", icon: "star" },
  { key: "B", label: "Nhóm B", bg: "bg-status-info/10", icon: "trending_up" },
  { key: "C", label: "Nhóm C", bg: "bg-status-warning/10", icon: "trending_flat" },
  { key: "slow", label: "Không có doanh số", bg: "bg-status-error/10", icon: "trending_down" },
];

export default function AbcAnalysisPage() {
  const { tenant, user, permissions, hasPermission, isLoading } = useAuth();
  const allowed = !isLoading && hasPermission("reports.analytics") && hasPermission("reports.view_detail");
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const [resultData, setData] = useState<AbcReportResult | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [search, setSearch] = useState(""), [unit, setUnit] = useState("");
  const scope = JSON.stringify([tenant?.id, user?.id, [...permissions ?? []].sort(), activeBranchId, range.from, range.to, allowed]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const data = allowed && isReady && loadedScope === scope && !error ? resultData : null;
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!allowed || !isReady || !tenant?.id) return;
    setLoading(true);
    setError(null); setData(null);
    try {
      const result = await getAbcReport({
        range,
        branchId: activeBranchId ?? undefined,
      });
      if (requestId !== requestIdRef.current || scopeRef.current !== scope) return;
      setData(result); setLoadedScope(scope);
    } catch (err) {
      if (requestId !== requestIdRef.current || scopeRef.current !== scope) return;
      setData(null); setLoadedScope(scope);
      setError(err instanceof Error ? err.message : "Không tải được báo cáo.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [range, activeBranchId, allowed, isReady, tenant?.id, scope]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
    return () => { requestIdRef.current += 1; };
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  const filteredRows = useMemo(
    () =>
      sortedReportView(searchOptions(data?.rows ?? [], search, row => ({ name: row.name, identifiers: [row.code] }))
        .map(({ item }) => item).filter(row => (filterMode === "all" || row.abcClass === filterMode) && (!unit || row.catalogUnit === unit)), sort),
    [data, filterMode, search, unit, sort],
  );
  const unitOptions = [...new Set([...(data?.rows.map(row => row.catalogUnit) ?? []), ...(unit ? [unit] : [])])]
    .sort((a, b) => a.localeCompare(b, "vi")).map(value => ({ value, label: value }));
  const visibleStats = (group: FilterMode) => {
    const selected = filteredRows.filter(row => row.abcClass === group);
    return { count: selected.length, pct: selected.reduce((sum, row) => sum + row.pct, 0).toFixed(1) };
  };
  const exportKey = JSON.stringify([scope, loadedScope, search, unit, filterMode, sort, loading, error]);
  const exportKeyRef = useRef(exportKey); exportKeyRef.current = exportKey;

  const handleExportView = useCallback(() => {
    if (!data || loading || !hasPermission("reports.export")) return;
    const key = exportKeyRef.current;
    setExportError(null);
    const titleRows = buildReportTitleRows({
      title: `Phân tích ABC ${filterMode !== "all" ? `(Lớp ${filterMode})` : ""}`,
      range,
      branchName,
      generatedAt: new Date(),
    });
    titleRows.push("Doanh số dòng hàng trước hàng trả và chiết khấu toàn đơn. ĐVT hiện tại chỉ tham khảo.");
    titleRows.push(`Tìm: ${search || "Tất cả"}; ĐVT hiện tại: ${unit || "Tất cả"}; Nhóm: ${filterMode}`);
    void exportReportToExcel({
      kind: "abc-analysis",
      mode: "view",
      range,
      branchName,
      shouldSave: () => exportKeyRef.current === key,
      sheets: [
        {
          name: "ABC Analysis",
          titleRows,
          tablePreferenceKey: "report.abc-analysis.products",
          columns: [
            { label: "Lớp", key: "abcClass", width: 8 },
            { label: "Mã hàng", key: "code", width: 14, hideable: false },
            { label: "Tên hàng", key: "name", width: 32 },
            { label: "ĐVT", key: "unit", width: 8 },
            { label: "ĐVT hiện tại (tham khảo)", key: "catalogUnit", width: 24 },
            { label: "SL bán", key: "qtySold", width: 10, format: "number" },
            { label: "Doanh thu", key: "revenue", width: 16, format: "currency" },
            { label: "% Doanh thu", key: "pct", width: 12, format: "number" },
            { label: "% Lũy kế", key: "cumPct", width: 12, format: "number" },
            { label: "Bán cuối (ngày)", key: "lastSoldDaysAgo", width: 14, format: "number" },
          ],
          rows: filteredRows.map((r) => ({
            abcClass: r.abcClass === "slow" ? "Không có doanh số" : r.abcClass,
            code: r.code,
            name: r.name,
            unit: r.unit,
            catalogUnit: r.catalogUnit,
            qtySold: r.qtySold,
            revenue: r.revenue,
            pct: r.pct,
            cumPct: r.cumPct,
            lastSoldDaysAgo: r.lastSoldDaysAgo,
          })),
          footerLabel: `SL mặt hàng: ${filteredRows.length}`,
        },
      ],
    }).catch(reason => { if (exportKeyRef.current === key) setExportError(reason instanceof Error ? reason.message : "Không xuất được Excel."); });
  }, [data, filteredRows, filterMode, range, branchName, loading, hasPermission, search, unit]);

  const handleExportFull = useCallback(() => {
    if (!data || loading || !hasPermission("reports.export_detail")) return;
    const key = exportKeyRef.current;
    setExportError(null);
    const summary = (["A", "B", "C", "slow"] as const).map(group => {
      const rows = filteredRows.filter(row => row.abcClass === group);
      return { label: group === "slow" ? "Không có doanh số" : `Nhóm ${group}`, count: rows.length,
        revenue: rows.reduce((sum, row) => sum + row.revenue, 0), pct: rows.reduce((sum, row) => sum + row.pct, 0) };
    });
    const titleRows = buildReportTitleRows({
      title: "Phân loại ABC — Đầy đủ theo bộ lọc",
      range,
      branchName,
      generatedAt: new Date(),
    });
    titleRows.push("Doanh số dòng hàng trước hàng trả và chiết khấu toàn đơn. ĐVT hiện tại chỉ tham khảo.");
    titleRows.push(`Tìm: ${search || "Tất cả"}; ĐVT hiện tại: ${unit || "Tất cả"}; Nhóm: ${filterMode}`);
    const buildSheet = (cls: "A" | "B" | "C" | "slow", label: string) => ({
      name: label,
      titleRows,
      columns: [
        { label: "Mã hàng", key: "code", width: 14 },
        { label: "Tên hàng", key: "name", width: 32 },
        { label: "ĐVT", key: "unit", width: 8 },
        { label: "ĐVT hiện tại (tham khảo)", key: "catalogUnit", width: 24 },
        { label: "SL bán", key: "qtySold", width: 10, format: "number" as const },
        { label: "Doanh thu", key: "revenue", width: 16, format: "currency" as const },
        { label: "% Doanh thu", key: "pct", width: 12, format: "number" as const },
        { label: "% Lũy kế", key: "cumPct", width: 12, format: "number" as const },
        { label: "Bán cuối trong kỳ (cách nay số ngày)", key: "lastSoldDaysAgo", width: 26, format: "number" as const },
      ],
      rows: filteredRows
        .filter((r) => r.abcClass === cls)
        .map((r) => ({
          code: r.code,
          name: r.name,
          unit: r.unit,
          catalogUnit: r.catalogUnit,
          qtySold: r.qtySold,
          revenue: r.revenue,
          pct: r.pct,
          cumPct: r.cumPct,
          lastSoldDaysAgo: r.lastSoldDaysAgo,
        })),
    });
    void exportReportToExcel({
      kind: "abc-analysis",
      mode: "full",
      range,
      branchName,
      shouldSave: () => exportKeyRef.current === key,
      sheets: [
        {
          name: "1. Tổng quan",
          titleRows,
          columns: [
            { label: "Lớp", key: "label", width: 18 },
            { label: "Số SP", key: "count", width: 10, format: "number" },
            { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
            { label: "% Doanh thu", key: "pct", width: 12, format: "number" },
          ],
          rows: summary,
          footerLabel: "Tổng",
          footer: {
            count: filteredRows.length,
            revenue: filteredRows.reduce((sum, row) => sum + row.revenue, 0),
            pct: filteredRows.reduce((sum, row) => sum + row.pct, 0),
          },
        },
        buildSheet("A", "2. Lớp A"),
        buildSheet("B", "3. Lớp B"),
        buildSheet("C", "4. Lớp C"),
        buildSheet("slow", "5. Không có doanh số"),
      ],
    }).catch(reason => { if (exportKeyRef.current === key) setExportError(reason instanceof Error ? reason.message : "Không xuất được Excel."); });
  }, [data, range, branchName, filteredRows, loading, hasPermission, search, unit, filterMode]);

  const columns: DataTableColumn<AbcRow>[] = [
    {
      label: "Nhóm",
      key: "abcClass",
      align: "center",
      cell: (r) => (
        <span
          className={cn(
            "inline-block px-2 py-0.5 rounded text-xs font-bold",
            r.abcClass === "A" && "bg-status-success/15 text-status-success",
            r.abcClass === "B" && "bg-status-info/15 text-status-info",
            r.abcClass === "C" && "bg-status-warning/15 text-status-warning",
            r.abcClass === "slow" && "bg-status-error/15 text-status-error",
          )}
        >
          {r.abcClass === "slow" ? "Không có doanh số" : r.abcClass}
        </span>
      ),
    },
    { label: "Mã hàng", key: "code", align: "left", width: "110px", hideable: false },
    { label: "Tên hàng", key: "name", align: "left" },
    { label: "ĐVT lịch sử", key: "unit", align: "left", width: "150px" },
    { label: "ĐVT hiện tại", key: "catalogUnit", align: "left", width: "100px" },
    {
      label: "Số lượng bán",
      key: "qtySold",
      align: "right",
      cell: (r) => r.qtySold === null ? "Không cộng khác ĐVT" : formatNumber(r.qtySold),
    },
    {
      label: "Doanh thu",
      key: "revenue",
      align: "right",
      cell: (r) => formatCurrency(r.revenue),
    },
    {
      label: "% Doanh thu",
      key: "pct",
      align: "right",
      cell: (r) => `${r.pct.toFixed(2)}%`,
    },
    {
      label: "% Luỹ kế",
      key: "cumPct",
      align: "right",
      cell: (r) => `${r.cumPct.toFixed(2)}%`,
    },
    {
      label: "Bán cuối trong kỳ",
      key: "lastSoldDaysAgo",
      align: "right",
      cell: (r) =>
        r.lastSoldDaysAgo == null
          ? <span className="text-muted-foreground">Không phát sinh trong kỳ</span>
          : `Cách đây ${r.lastSoldDaysAgo} ngày`,
    },
  ];

  if (isLoading) return <p role="status" className="p-6">Đang xác thực quyền báo cáo...</p>;
  if (!allowed) return <p role="alert" className="p-6">Chưa được cấp quyền xem phân tích chi tiết.</p>;
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <ReportPageHeader
        title="Phân loại sản phẩm theo doanh thu"
        subtitle="Dòng hàng hóa đơn hoàn tất · Ngày chứng từ · Giờ Việt Nam"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={hasPermission("reports.export") ? handleExportView : undefined}
        onExportFull={hasPermission("reports.export_detail") ? handleExportFull : undefined}
        exportDisabled={loading || !data}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {exportError && <p role="alert">{exportError}</p>}
        <div className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
          <p>Doanh số trước trả hàng, chưa trừ chiết khấu toàn đơn.</p>
          <details className="mt-1"><summary className="cursor-pointer font-medium">Cơ sở phân loại</summary><p className="mt-2">Ngưỡng lũy kế 80% / 95%; mặt hàng vượt ngưỡng giữ trong nhóm đang xét. Tỷ trọng tính trên toàn kỳ, không xếp nhóm lại khi tìm kiếm. ĐVT hiện tại chỉ tham khảo. Nhóm không có doanh số gồm danh mục dùng chung chưa có doanh số dương tại phạm vi đã chọn; không đồng nghĩa hàng tồn chậm luân chuyển.</p></details>
        </div>
        <div className="flex flex-wrap gap-3">
          <Input aria-label="Tìm mặt hàng" placeholder="Mã hoặc tên mặt hàng" value={search} onChange={event => setSearch(event.target.value)} className="min-w-48 flex-1" />
          <SearchableSelect aria-label="ĐVT hiện tại" options={[{ value: "", label: "Tất cả ĐVT hiện tại" }, ...unitOptions]} value={unit} onValueChange={setUnit} placeholder="Tất cả ĐVT hiện tại" className="w-52" />
        </div>
        {/* KPI cards */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Nhóm A · Chủ lực" value={String(visibleStats("A").count)} hint={`${visibleStats("A").pct}% doanh số kỳ`} className="border-l-emerald-500 bg-emerald-50/60" />
            <SummaryCard label="Nhóm B · Tiếp theo" value={String(visibleStats("B").count)} hint={`${visibleStats("B").pct}% doanh số kỳ`} className="border-l-sky-500 bg-sky-50/60" />
            <SummaryCard label="Nhóm C · Còn lại" value={String(visibleStats("C").count)} hint={`${visibleStats("C").pct}% doanh số kỳ`} className="border-l-amber-500 bg-amber-50/60" />
            <SummaryCard label="Không có doanh số" value={String(visibleStats("slow").count)} hint="Danh mục trong kỳ" className="border-l-rose-400 bg-rose-50/60" />
          </div>
        )}

        {/* Filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilterMode(opt.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition-colors press-scale-sm border",
                filterMode === opt.key
                  ? "bg-primary text-primary-foreground border-primary ambient-shadow"
                  : "bg-surface-container-lowest text-foreground border-border hover:bg-surface-container",
              )}
            >
              <Icon name={opt.icon} size={14} />
              {opt.label}
            </button>
          ))}
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Đang tải dữ liệu phân tích ABC...
            </p>
          </div>
        ) : error ? (
          <div role="alert" className="space-y-2"><p>{error}</p><button onClick={fetchData} className="text-primary underline">Thử lại</button></div>
        ) : !data ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Không có dữ liệu
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-lg ambient-shadow">
            <ReportDataTable<AbcRow>
              columns={columns}
              tablePreferenceKey="report.abc-analysis.products"
              rows={filteredRows}
              sortState={sort}
              onSortChange={setSort}
              getRowKey={(r) => r.productId}
              subtotalLabel={`SL mặt hàng: ${filteredRows.length}`}
              emptyState="Không có mặt hàng phù hợp."
            />
          </div>
        )}
      </div>
    </div>
  );
}
