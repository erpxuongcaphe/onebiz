"use client";

/**
 * Báo cáo ABC Analysis + Slow Movers — REP-3 (CEO 06/05/2026).
 *
 * Phân loại SP theo Pareto 80/15/5:
 * - A: top 80% doanh thu (priority high)
 * - B: 15% kế tiếp
 * - C: 5% cuối (cân nhắc cắt)
 * - Slow: KHÔNG bán trong kỳ
 */

import { useEffect, useState, useCallback } from "react";
import { useBranchFilter } from "@/lib/contexts";
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
import { KpiCard } from "../_components";

type FilterMode = "all" | "A" | "B" | "C" | "slow";

const FILTER_OPTIONS: { key: FilterMode; label: string; bg: string; icon: string }[] = [
  { key: "all", label: "Tất cả", bg: "bg-surface-container-low", icon: "category" },
  { key: "A", label: "Lớp A (80%)", bg: "bg-status-success/10", icon: "star" },
  { key: "B", label: "Lớp B (15%)", bg: "bg-status-info/10", icon: "trending_up" },
  { key: "C", label: "Lớp C (5%)", bg: "bg-status-warning/10", icon: "trending_flat" },
  { key: "slow", label: "Bán chậm", bg: "bg-status-error/10", icon: "trending_down" },
];

export default function AbcAnalysisPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [data, setData] = useState<AbcReportResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAbcReport({
        range,
        branchId: activeBranchId ?? undefined,
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch ABC report:", err);
    } finally {
      setLoading(false);
    }
  }, [range, activeBranchId]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  const filteredRows =
    data && filterMode !== "all"
      ? data.rows.filter((r) => r.abcClass === filterMode)
      : data?.rows ?? [];

  const handleExportView = useCallback(() => {
    if (!data) return;
    const titleRows = buildReportTitleRows({
      title: `Phân tích ABC ${filterMode !== "all" ? `(Lớp ${filterMode})` : ""}`,
      range,
      branchName,
      generatedAt: new Date(),
    });
    exportReportToExcel({
      kind: "hang-hoa",
      mode: "view",
      range,
      branchName,
      sheets: [
        {
          name: "ABC Analysis",
          titleRows,
          columns: [
            { label: "Lớp", key: "abcClass", width: 8 },
            { label: "Mã hàng", key: "code", width: 14 },
            { label: "Tên hàng", key: "name", width: 32 },
            { label: "ĐVT", key: "unit", width: 8 },
            { label: "SL bán", key: "qtySold", width: 10, format: "number" },
            { label: "Doanh thu", key: "revenue", width: 16, format: "currency" },
            { label: "% Doanh thu", key: "pct", width: 12, format: "number" },
            { label: "% Lũy kế", key: "cumPct", width: 12, format: "number" },
            { label: "Bán cuối (ngày)", key: "lastSoldDaysAgo", width: 14, format: "number" },
          ],
          rows: filteredRows.map((r) => ({
            abcClass: r.abcClass === "slow" ? "Bán chậm" : r.abcClass,
            code: r.code,
            name: r.name,
            unit: r.unit,
            qtySold: r.qtySold,
            revenue: r.revenue,
            pct: r.pct,
            cumPct: r.cumPct,
            lastSoldDaysAgo: r.lastSoldDaysAgo ?? "—",
          })),
          footerLabel: `SL mặt hàng: ${filteredRows.length}`,
        },
      ],
    });
  }, [data, filteredRows, filterMode, range, branchName]);

  const handleExportFull = useCallback(() => {
    if (!data) return;
    const titleRows = buildReportTitleRows({
      title: "Phân tích ABC + Slow Movers — Đầy đủ",
      range,
      branchName,
      generatedAt: new Date(),
    });
    const buildSheet = (cls: "A" | "B" | "C" | "slow", label: string) => ({
      name: label,
      columns: [
        { label: "Mã hàng", key: "code", width: 14 },
        { label: "Tên hàng", key: "name", width: 32 },
        { label: "ĐVT", key: "unit", width: 8 },
        { label: "SL bán", key: "qtySold", width: 10, format: "number" as const },
        { label: "Doanh thu", key: "revenue", width: 16, format: "currency" as const },
        { label: "% Doanh thu", key: "pct", width: 12, format: "number" as const },
        { label: "% Lũy kế", key: "cumPct", width: 12, format: "number" as const },
      ],
      rows: data.rows
        .filter((r) => r.abcClass === cls)
        .map((r) => ({
          code: r.code,
          name: r.name,
          unit: r.unit,
          qtySold: r.qtySold,
          revenue: r.revenue,
          pct: r.pct,
          cumPct: r.cumPct,
        })),
    });
    exportReportToExcel({
      kind: "hang-hoa",
      mode: "full",
      range,
      branchName,
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
          rows: [
            { label: "Lớp A (top 80%)", count: data.classStats.A.count, revenue: data.classStats.A.revenue, pct: data.classStats.A.revenuePct },
            { label: "Lớp B (kế 15%)", count: data.classStats.B.count, revenue: data.classStats.B.revenue, pct: data.classStats.B.revenuePct },
            { label: "Lớp C (cuối 5%)", count: data.classStats.C.count, revenue: data.classStats.C.revenue, pct: data.classStats.C.revenuePct },
            { label: "Bán chậm (KHÔNG bán)", count: data.classStats.slow.count, revenue: 0, pct: 0 },
          ],
          footerLabel: "Tổng",
          footer: {
            count: data.classStats.A.count + data.classStats.B.count + data.classStats.C.count + data.classStats.slow.count,
            revenue: data.totalRevenue,
            pct: 100,
          },
        },
        buildSheet("A", "2. Lớp A"),
        buildSheet("B", "3. Lớp B"),
        buildSheet("C", "4. Lớp C"),
        buildSheet("slow", "5. Bán chậm"),
      ],
    });
  }, [data, range, branchName]);

  const columns: DataTableColumn<AbcRow>[] = [
    {
      label: "Lớp",
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
          {r.abcClass === "slow" ? "Slow" : r.abcClass}
        </span>
      ),
    },
    { label: "Mã hàng", key: "code", align: "left", width: "110px" },
    { label: "Tên hàng", key: "name", align: "left" },
    { label: "ĐVT", key: "unit", align: "left", width: "70px" },
    {
      label: "SL bán",
      key: "qtySold",
      align: "right",
      cell: (r) => formatNumber(r.qtySold),
    },
    {
      label: "Doanh thu",
      key: "revenue",
      align: "right",
      cell: (r) => formatCurrency(r.revenue),
    },
    {
      label: "% DT",
      key: "pct",
      align: "right",
      cell: (r) => `${r.pct.toFixed(2)}%`,
    },
    {
      label: "% Lũy kế",
      key: "cumPct",
      align: "right",
      cell: (r) => `${r.cumPct.toFixed(2)}%`,
    },
    {
      label: "Bán cuối",
      key: "lastSoldDaysAgo",
      align: "right",
      cell: (r) =>
        r.lastSoldDaysAgo == null
          ? <span className="text-status-error font-medium">Chưa bán</span>
          : `${r.lastSoldDaysAgo} ngày`,
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <ReportPageHeader
        title="Phân tích ABC + Slow Movers"
        subtitle="Phân loại SP theo Pareto 80/15/5 + xác định SP bán chậm"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || !data}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI cards */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Lớp A"
              value={String(data.classStats.A.count)}
              change={`${data.classStats.A.revenuePct}% doanh thu`}
              positive
              icon="star"
              bg="bg-status-success/10"
              iconColor="text-status-success"
              valueColor="text-foreground"
            />
            <KpiCard
              label="Lớp B"
              value={String(data.classStats.B.count)}
              change={`${data.classStats.B.revenuePct}% doanh thu`}
              positive
              icon="trending_up"
              bg="bg-status-info/10"
              iconColor="text-status-info"
              valueColor="text-foreground"
            />
            <KpiCard
              label="Lớp C"
              value={String(data.classStats.C.count)}
              change={`${data.classStats.C.revenuePct}% doanh thu`}
              positive={false}
              icon="trending_flat"
              bg="bg-status-warning/10"
              iconColor="text-status-warning"
              valueColor="text-foreground"
            />
            <KpiCard
              label="Bán chậm"
              value={String(data.classStats.slow.count)}
              change="SP không bán trong kỳ"
              positive={false}
              icon="trending_down"
              bg="bg-status-error/10"
              iconColor="text-status-error"
              valueColor="text-foreground"
            />
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
        ) : !data ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Không có dữ liệu
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow">
            <ReportDataTable<AbcRow>
              columns={columns}
              rows={filteredRows}
              getRowKey={(r) => r.productId}
              subtotalLabel={`SL mặt hàng: ${filteredRows.length}`}
              emptyState={
                filterMode === "slow"
                  ? "Không có SP bán chậm — tốt!"
                  : "Không có SP trong nhóm này"
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
