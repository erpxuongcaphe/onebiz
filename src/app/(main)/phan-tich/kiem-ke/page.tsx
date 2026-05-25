"use client";

/**
 * Báo cáo kiểm kê — Sprint KK-DETAIL (CEO 06/05/2026).
 *
 * KPI: Số phiếu / Lệch tăng / Lệch giảm / Net thiệt hại + so sánh kỳ trước.
 * Bảng: List phiếu kiểm kê trong kỳ với từng metric.
 */

import { useEffect, useState, useCallback } from "react";
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
} from "@/lib/utils/excel-export";
import { getInventoryCheckReport } from "@/lib/services/supabase/inventory-check-report";
import type {
  InventoryCheckReportRow,
  InventoryCheckReportResult,
} from "@/lib/services/supabase/inventory-check-report";
import { KpiCard } from "../_components";
import { cn } from "@/lib/utils";

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
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });

  const [data, setData] = useState<InventoryCheckReportResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getInventoryCheckReport({
        range,
        branchId: activeBranchId ?? undefined,
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch inventory check report:", err);
      toast({
        title: "Lỗi tải báo cáo kiểm kê",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [range, activeBranchId, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  const handleExportView = useCallback(() => {
    if (!data) return;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo kiểm kê",
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
          name: "Báo cáo kiểm kê",
          titleRows,
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
        },
      ],
    });
  }, [data, range, branchName]);

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
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <ReportPageHeader
        title="Báo cáo kiểm kê"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        exportDisabled={loading || !data}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
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
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Chưa có phiếu kiểm kê nào trong kỳ này
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow">
            <ReportDataTable<InventoryCheckReportRow>
              columns={columns}
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
