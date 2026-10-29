"use client";

/**
 * Báo cáo kiểm kê — Sprint KK-DETAIL (CEO 06/05/2026).
 *
 * KPI: Số phiếu / Lệch tăng / Lệch giảm / Net thiệt hại + so sánh kỳ trước.
 * Bảng: List phiếu kiểm kê trong kỳ với từng metric.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency, formatShortDate } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
  buildMetricSummarySheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { getInventoryCheckReport } from "@/lib/services/supabase/inventory-check-report";
import type {
  InventoryCheckReportRow,
  InventoryCheckReportResult,
  InventoryCheckDetailRow,
} from "@/lib/services/supabase/inventory-check-report";
import { KpiCard } from "../_components";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { searchOptions } from "@/lib/search-options";
import { stockUnitColumns, STOCK_UNIT_EXCEL_COLUMNS } from "@/components/shared/report/stock-unit-columns";
import { reportUnitLabel } from "@/lib/reports/stock-unit-context";

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  processing: "Phiếu tạm",
  balanced: "Đã cân bằng kho",
  unbalanced: "Đã huỷ",
};

export default function KiemKeReportPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });

  const [data, setData] = useState<InventoryCheckReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const [tab, setTab] = useState<"checks" | "items">("items");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [sort, setSort] = useState({ id: "checkDate", direction: "desc" as "asc" | "desc" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const detailRows = useMemo(() => searchOptions(data?.details ?? [], search, row => ({ name: `${row.productName} ${row.branchName}`, identifiers: [row.productCode ?? "", row.checkCode] })).map(match => match.item)
    .filter(row => !unitFilter || row.catalogUnit === unitFilter)
    .sort((a, b) => {
      const left = a[sort.id as keyof InventoryCheckDetailRow], right = b[sort.id as keyof InventoryCheckDetailRow];
      const result = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), "vi");
      return (sort.direction === "asc" ? result : -result) || a.id.localeCompare(b.id);
    }), [data, search, unitFilter, sort]);
  const unitOptions = useMemo(() => [...new Set((data?.details ?? []).flatMap(row => row.catalogUnit ? [row.catalogUnit] : []))].sort((a, b) => a.localeCompare(b, "vi")), [data]);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setData(null);
    setLoadError(null);
    try {
      const result = await getInventoryCheckReport({
        range,
        branchId: activeBranchId ?? undefined,
      });
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Failed to fetch inventory check report:", err);
      setLoadError(err instanceof Error ? err.message : "Không tải được báo cáo kiểm kê.");
      toast({
        title: "Lỗi tải báo cáo kiểm kê",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [range, activeBranchId, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
    return () => { requestIdRef.current += 1; };
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  const handleExport = useCallback((mode: "view" | "full") => {
    if (!data) return;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo kiểm kê",
      range,
      branchName,
      generatedAt: new Date(),
    });
    const detailSheet: ExcelSheet = {
      name: "Chi tiết mặt hàng", titleRows,
      tablePreferenceKey: "report.kiem-ke.items",
      columns: [
        { key: "checkCode", label: "Mã phiếu", width: 18 },
        { key: "checkDate", label: "Ngày kiểm", width: 18 },
        { key: "branchName", label: "Chi nhánh", width: 26 },
        { key: "productCode", label: "Mã hàng", width: 18 },
        { key: "productName", label: "Mặt hàng", width: 36 },
        ...STOCK_UNIT_EXCEL_COLUMNS,
        { key: "systemStock", label: "Sổ sách", width: 18, format: "number" as const },
        { key: "actualStock", label: "Thực tế", width: 18, format: "number" as const },
        { key: "difference", label: "Chênh lệch", width: 18, format: "number" as const },
      ],
      rows: detailRows.map(row => ({ ...row, checkDate: formatShortDate(row.checkDate), recordedUnit: reportUnitLabel(row), recordedConversion: row.recordedConversion ?? "Chưa lưu", recordedCount: row.recordedCount ?? "Chưa lưu" })),
      footerLabel: `${detailRows.length} dòng mặt hàng; không cộng số lượng khác ĐVT`,
    };
    exportReportToExcel({
      kind: "kiem-ke",
      mode,
      range,
      branchName,
      sheets: [
        ...(mode === "full"
          ? [
              buildMetricSummarySheet({
                title: "TÓM TẮT KIỂM KÊ",
                metrics: [
                  {
                    label: "Số phiếu kiểm trong kỳ",
                    value: data.summary.totalChecks,
                    format: "number",
                    note: `Kỳ trước: ${data.summary.prevTotalChecks}`,
                  },
                  {
                    label: "Lệch tăng (kho dư)",
                    value: data.summary.totalIncrease,
                    format: "currency",
                    note: `Kỳ trước: ${data.summary.prevTotalIncrease}`,
                  },
                  {
                    label: "Lệch giảm (thiệt hại)",
                    value: data.summary.totalDecrease,
                    format: "currency",
                    note: `Kỳ trước: ${data.summary.prevTotalDecrease}`,
                  },
                  {
                    label: "Chênh lệch ròng",
                    value: data.summary.netImpact,
                    format: "currency",
                    note:
                      "Số dương = thừa ròng; số âm = thiếu ròng",
                  },
                ],
              }),
            ]
          : []),
        ...(mode === "full" || tab === "checks" ? [{
          name: "Báo cáo kiểm kê",
          titleRows,
          tablePreferenceKey: "report.kiem-ke.checks",
          columns: [
            { label: "Mã phiếu", key: "code", width: 14 },
            { label: "Ngày kiểm", key: "date", width: 12 },
            { label: "Chi nhánh", key: "branchName", width: 20 },
            { label: "Người kiểm", key: "createdByName", width: 20 },
            { label: "Trạng thái", key: "status", width: 18 },
            { label: "Số sản phẩm", key: "totalProducts", width: 12, format: "number" },
            { label: "Lệch tăng (giá trị)", key: "totalIncrease", width: 18, format: "currency" },
            { label: "Lệch giảm (giá trị)", key: "totalDecrease", width: 18, format: "currency" },
            { label: "Chênh lệch ròng", key: "netImpact", width: 18, format: "currency" },
          ],
          rows: data.rows.map((r) => ({
            code: r.code,
            date: formatShortDate(r.date),
            branchName: r.branchName,
            createdByName: r.createdByName,
            status: STATUS_LABEL[r.status] ?? r.status,
            totalProducts: r.totalProducts,
            totalIncrease: r.totalIncrease,
            totalDecrease: r.totalDecrease,
            netImpact: r.netImpact,
          })),
          footerLabel: `Tổng số phiếu: ${data.summary.totalChecks}`,
          footer: {
            totalProducts: data.rows.reduce((s, r) => s + r.totalProducts, 0),
            totalIncrease: data.summary.totalIncrease,
            totalDecrease: data.summary.totalDecrease,
            netImpact: data.summary.netImpact,
          },
        } satisfies ExcelSheet] : []),
        ...(mode === "full" || tab === "items" ? [detailSheet] : []),
      ],
    });
  }, [data, range, branchName, detailRows, tab]);

  const detailColumns: DataTableColumn<InventoryCheckDetailRow>[] = [
    { key: "checkCode", label: "Mã phiếu", width: "150px" },
    { key: "checkDate", label: "Ngày kiểm", width: "120px", cell: row => formatShortDate(row.checkDate) },
    { key: "branchName", label: "Chi nhánh", width: "200px" },
    { key: "productCode", label: "Mã hàng", width: "150px" },
    { key: "productName", label: "Mặt hàng", width: "240px" },
    ...stockUnitColumns<InventoryCheckDetailRow>(),
    { key: "systemStock", label: "Sổ sách", align: "right", cell: row => formatNumber(row.systemStock) },
    { key: "actualStock", label: "Thực tế", align: "right", cell: row => formatNumber(row.actualStock) },
    { key: "difference", label: "Chênh lệch", align: "right", cell: row => formatNumber(row.difference) },
  ];

  const columns: DataTableColumn<InventoryCheckReportRow>[] = [
    { label: "Mã phiếu", key: "code", align: "left", width: "120px" },
    {
      label: "Ngày kiểm",
      key: "date",
      align: "center",
      cell: (r) => formatShortDate(r.date),
    },
    { label: "Chi nhánh", key: "branchName", align: "left" },
    { label: "Người kiểm", key: "createdByName", align: "left" },
    {
      label: "Trạng thái",
      key: "status",
      align: "center",
      cell: (r) => (
        <span
          className={cn(
            "inline-block px-2 py-0.5 rounded text-xs font-medium",
            r.status === "balanced" &&
              "bg-status-success/10 text-status-success",
            r.status === "processing" &&
              "bg-status-warning/10 text-status-warning",
            r.status === "unbalanced" &&
              "bg-status-error/10 text-status-error",
          )}
        >
          {STATUS_LABEL[r.status] ?? r.status}
        </span>
      ),
    },
    {
      label: "Số sản phẩm",
      key: "totalProducts",
      align: "right",
      cell: (r) => formatNumber(r.totalProducts),
    },
    {
      label: "Lệch tăng",
      key: "totalIncrease",
      align: "right",
      cell: (r) => (
        <span className="text-status-success font-medium">
          {r.totalIncrease > 0 ? `+${formatCurrency(r.totalIncrease)}` : "—"}
        </span>
      ),
    },
    {
      label: "Lệch giảm",
      key: "totalDecrease",
      align: "right",
      cell: (r) => (
        <span className="text-status-error font-medium">
          {r.totalDecrease > 0 ? `−${formatCurrency(r.totalDecrease)}` : "—"}
        </span>
      ),
    },
    {
      label: "Chênh lệch ròng",
      key: "netImpact",
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "font-bold",
            r.netImpact > 0 && "text-status-success",
            r.netImpact < 0 && "text-status-error",
            r.netImpact === 0 && "text-muted-foreground",
          )}
        >
          {r.netImpact === 0
            ? "—"
            : `${r.netImpact > 0 ? "+" : ""}${formatCurrency(r.netImpact)}`}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <ReportPageHeader
        title="Báo cáo kiểm kê"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={() => handleExport("view")}
        onExportFull={() => handleExport("full")}
        exportDisabled={loading || !data}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        <div role="tablist" aria-label="Góc nhìn kiểm kê" className="flex border-b gap-4">
          {([ ["items", "Chi tiết mặt hàng"], ["checks", "Theo phiếu"] ] as const).map(([value, label]) => <button type="button" role="tab" key={value} aria-selected={tab === value} onClick={() => setTab(value)} className={cn("min-h-10 border-b-2 px-1 text-sm", tab === value ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground")}>{label}</button>)}
        </div>
        {tab === "items" && <div className="flex flex-wrap gap-2">
          <Input className="max-w-sm" aria-label="Tìm dòng kiểm kê" placeholder="Mã phiếu, mã hàng, tên hàng" value={search} onChange={event => setSearch(event.target.value)} />
          <select className="h-10 border rounded bg-background px-3 text-sm" aria-label="ĐVT danh mục" value={unitFilter} onChange={event => setUnitFilter(event.target.value)}><option value="">Tất cả ĐVT danh mục</option>{unitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select>
          {(search || unitFilter) && <button type="button" onClick={() => { setSearch(""); setUnitFilter(""); }} className="min-h-10 text-sm text-primary">Xóa lọc</button>}
        </div>}
        <p className="text-xs text-muted-foreground">Số lượng theo ĐVT ghi sổ. Quy cách hiện tại chỉ để tham chiếu; không dùng để quy đổi lại phiếu cũ chưa lưu ĐVT.</p>
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Số phiếu kiểm trong kỳ"
              value={String(data.summary.totalChecks)}
              change={
                data.summary.prevTotalChecks > 0
                  ? `${pctChange(data.summary.totalChecks, data.summary.prevTotalChecks)} so với kỳ trước`
                  : undefined
              }
              positive={
                data.summary.totalChecks >= data.summary.prevTotalChecks
              }
              icon="fact_check"
              bg="bg-primary-fixed"
              iconColor="text-primary"
              valueColor="text-foreground"
            />
            <KpiCard
              label="Lệch tăng (kho dư)"
              value={formatCurrency(data.summary.totalIncrease) + "đ"}
              change={
                data.summary.prevTotalIncrease > 0
                  ? `${pctChange(data.summary.totalIncrease, data.summary.prevTotalIncrease)} so với kỳ trước`
                  : undefined
              }
              positive
              icon="trending_up"
              bg="bg-status-success/10"
              iconColor="text-status-success"
              valueColor="text-foreground"
            />
            <KpiCard
              label="Lệch giảm (thiệt hại)"
              value={formatCurrency(data.summary.totalDecrease) + "đ"}
              change={
                data.summary.prevTotalDecrease > 0
                  ? `${pctChange(data.summary.totalDecrease, data.summary.prevTotalDecrease)} so với kỳ trước`
                  : undefined
              }
              positive={
                data.summary.totalDecrease <= data.summary.prevTotalDecrease
              }
              icon="trending_down"
              bg="bg-status-error/10"
              iconColor="text-status-error"
              valueColor="text-foreground"
            />
            <KpiCard
              label="Chênh lệch ròng"
              value={
                (data.summary.netImpact >= 0 ? "+" : "−") +
                formatCurrency(Math.abs(data.summary.netImpact)) +
                "đ"
              }
              change={
                data.summary.prevNetImpact !== 0
                  ? `Kỳ trước: ${data.summary.prevNetImpact >= 0 ? "+" : "−"}${formatCurrency(Math.abs(data.summary.prevNetImpact))}đ`
                  : undefined
              }
              positive={data.summary.netImpact >= 0}
              icon="balance"
              bg="bg-status-info/10"
              iconColor="text-status-info"
              valueColor="text-foreground"
            />
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Đang tải báo cáo kiểm kê...
            </p>
          </div>
        ) : loadError ? <div role="alert" className="space-y-2"><p>{loadError}</p><button type="button" className="min-h-10 text-primary" onClick={() => void fetchData()}>Thử lại</button></div> : !data || data.rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Chưa có phiếu kiểm kê nào trong kỳ này
          </div>
        ) : tab === "items" ? (
          <ReportDataTable<InventoryCheckDetailRow> columns={detailColumns} tablePreferenceKey="report.kiem-ke.items" rows={detailRows} getRowKey={row => row.id} sortState={sort} onSortChange={setSort} subtotalLabel={`${detailRows.length} dòng mặt hàng`} emptyState="Không có dòng kiểm kê phù hợp" />
        ) : (
          <div className="bg-surface-container-lowest rounded-lg ambient-shadow">
            <ReportDataTable<InventoryCheckReportRow>
              columns={columns}
              tablePreferenceKey="report.kiem-ke.checks"
              rows={data.rows}
              getRowKey={(r) => r.id}
              subtotalLabel={`Tổng số phiếu: ${data.summary.totalChecks}`}
              emptyState="Chưa có phiếu kiểm kê"
            />
          </div>
        )}
      </div>
    </div>
  );
}
