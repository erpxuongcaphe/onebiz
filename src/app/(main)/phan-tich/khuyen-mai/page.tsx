"use client";

/**
 * Báo cáo hiệu quả khuyến mãi — Sprint KM-4
 *
 * KPI cards:
 *   - Tổng lượt dùng (count invoices có promotion_id)
 *   - Tổng giảm giá (sum promotion_discount)
 *   - Tổng trị giá quà tặng (sum promotion_free_value)
 *   - ROI ước lượng (revenueWithPromo / cost)
 *
 * Charts:
 *   - Daily trend bar chart: lượt dùng + discount theo ngày
 *
 * Tables:
 *   - Bảng top KM theo discount + lượt dùng (per-promotion detail)
 */

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  getPromotionKpis,
  getPromotionDetailRows,
  getPromotionDailyTrend,
  type PromotionKpis,
  type PromotionDetailRow,
  type PromotionDailyPoint,
} from "@/lib/services/supabase/promotion-analytics";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";

const TYPE_LABEL: Record<string, string> = {
  discount_percent: "Giảm %",
  discount_fixed: "Giảm cố định",
  buy_x_get_y: "Mua X tặng Y",
  gift: "Tặng quà",
};

const CHANNEL_LABEL: Record<string, string> = {
  retail: "Retail",
  fnb: "FnB",
  both: "Cả hai",
};

function formatDateLabel(iso: string): string {
  // YYYY-MM-DD → DD/MM
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function DailyTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">
        {label ? formatDateLabel(label) : ""}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-xs">
          <span className="text-muted-foreground">{p.name}: </span>
          <span className="font-semibold">
            {p.dataKey === "totalDiscount"
              ? formatCurrency(p.value)
              : `${p.value} đơn`}
          </span>
        </p>
      ))}
    </div>
  );
}

export default function KhuyenMaiAnalyticsPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<PromotionKpis | null>(null);
  const [detailRows, setDetailRows] = useState<PromotionDetailRow[]>([]);
  const [dailyTrend, setDailyTrend] = useState<PromotionDailyPoint[]>([]);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO KHUYẾN MÃI",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = {
        name: "Chi tiết KM",
        titleRows: title,
        columns: [
          { label: "Tên CT khuyến mãi", key: "name", width: 32 },
          { label: "Loại", key: "type", width: 16 },
          { label: "Kênh", key: "channel", width: 12 },
          { label: "Lượt dùng", key: "uses", width: 12, format: "number" },
          { label: "Tổng giảm (VND)", key: "discount", width: 18, format: "currency" },
          { label: "DT phát sinh (VND)", key: "revenue", width: 20, format: "currency" },
        ],
        rows: detailRows.map((r) => ({
          name: r.name,
          type: TYPE_LABEL[r.type] ?? r.type,
          channel: CHANNEL_LABEL[r.channel] ?? r.channel,
          uses: r.invoiceCount,
          discount: r.totalDiscount,
          revenue: r.totalRevenue,
        })),
        footer: {
          name: "TỔNG",
          type: "",
          channel: "",
          uses: detailRows.reduce((s, r) => s + r.invoiceCount, 0),
          discount: detailRows.reduce((s, r) => s + r.totalDiscount, 0),
          revenue: detailRows.reduce((s, r) => s + r.totalRevenue, 0),
        },
      };
      exportReportToExcel({
        kind: "khuyen-mai",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [detailRows, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO KHUYẾN MÃI — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        {
          name: "KPI",
          titleRows: title,
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 28 },
            { label: "Giá trị", key: "value", width: 18, format: "currency" },
          ],
          rows: [
            { metric: "Tổng lượt dùng", value: kpis?.totalUsageCount ?? 0 },
            { metric: "Tổng giảm giá", value: kpis?.totalDiscount ?? 0 },
            { metric: "Tổng quà tặng", value: kpis?.totalFreeValue ?? 0 },
            { metric: "Doanh thu phát sinh", value: kpis?.revenueWithPromo ?? 0 },
          ],
        },
        {
          name: "Chi tiết CT",
          titleRows: ["CHI TIẾT TỪNG CT KHUYẾN MÃI", ...title.slice(1)],
          columns: [
            { label: "Tên CT", key: "name", width: 32 },
            { label: "Loại", key: "type", width: 16 },
            { label: "Kênh", key: "channel", width: 12 },
            { label: "Lượt dùng", key: "uses", width: 12, format: "number" },
            { label: "Tổng giảm (VND)", key: "discount", width: 18, format: "currency" },
            { label: "DT phát sinh (VND)", key: "revenue", width: 20, format: "currency" },
          ],
          rows: detailRows.map((r) => ({
            name: r.name,
            type: TYPE_LABEL[r.type] ?? r.type,
            channel: CHANNEL_LABEL[r.channel] ?? r.channel,
            uses: r.invoiceCount,
            discount: r.totalDiscount,
            revenue: r.totalRevenue,
          })),
        },
        {
          name: "Theo ngày",
          titleRows: ["XU HƯỚNG THEO NGÀY", ...title.slice(1)],
          columns: [
            { label: "Ngày", key: "date", width: 14 },
            { label: "Lượt dùng", key: "uses", width: 12, format: "number" },
            { label: "Giảm giá (VND)", key: "discount", width: 18, format: "currency" },
          ],
          rows: dailyTrend.map((p) => ({
            date: p.date,
            uses: p.usageCount,
            discount: p.totalDiscount,
          })),
        },
      ];
      exportReportToExcel({
        kind: "khuyen-mai",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({ title: "Đã xuất Excel (đầy đủ)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [kpis, detailRows, dailyTrend, range, branchLabel, toast]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [kpiData, rows, trend] = await Promise.all([
        getPromotionKpis({ branchId: activeBranchId }),
        getPromotionDetailRows({ branchId: activeBranchId }),
        getPromotionDailyTrend({ days: 30, branchId: activeBranchId }),
      ]);
      setKpis(kpiData);
      setDetailRows(rows);
      setDailyTrend(trend);
    } catch (err) {
      console.error("Failed to fetch promotion analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      <ReportPageHeader
        title="Hiệu quả khuyến mãi"
        subtitle="Lượt dùng, doanh thu và ROI của các chương trình khuyến mãi"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading}
      />
      <div className="space-y-4 lg:space-y-6 p-4 lg:p-6">

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <KpiCard
          label="Lượt dùng KM"
          value={kpis ? `${kpis.totalUsageCount}` : "0"}
          icon="redeem"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-foreground"
          change={
            kpis && kpis.activePromotionsCount > 0
              ? `${kpis.activePromotionsCount} KM đang chạy`
              : undefined
          }
        />
        <KpiCard
          label="Tổng giảm giá"
          value={kpis ? formatCurrency(kpis.totalDiscount) : formatCurrency(0)}
          icon="percent"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
        <KpiCard
          label="Trị giá quà tặng"
          value={kpis ? formatCurrency(kpis.totalFreeValue) : formatCurrency(0)}
          icon="card_giftcard"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="ROI ước lượng"
          value={
            kpis && kpis.estimatedRoi > 0 ? `${kpis.estimatedRoi.toFixed(2)}x` : "—"
          }
          icon="trending_up"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor={
            kpis && kpis.estimatedRoi >= 1 ? "text-status-success" : "text-foreground"
          }
          change={
            kpis ? `Doanh thu KM: ${formatCurrency(kpis.revenueWithPromo)}` : undefined
          }
        />
      </div>

      {/* Daily trend chart */}
      <ChartCard title="Xu hướng KM 30 ngày">
        {loading ? (
          <div className="h-[280px] flex items-center justify-center">
            <Icon
              name="progress_activity"
              size={20}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : dailyTrend.length === 0 || dailyTrend.every((d) => d.usageCount === 0) ? (
          <div className="h-[280px] flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
            <Icon name="bar_chart" size={32} className="opacity-40" />
            <span>Chưa có đơn nào áp KM trong 30 ngày qua</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280} minWidth={0}>
            <BarChart data={dailyTrend} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                yAxisId="left"
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<DailyTrendTooltip />} />
              <Bar
                yAxisId="left"
                dataKey="usageCount"
                name="Lượt dùng"
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="totalDiscount"
                name="Tổng giảm"
                fill="#ef4444"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Detail table */}
      <ChartCard title="Chi tiết theo chương trình">
        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <Icon
              name="progress_activity"
              size={20}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : detailRows.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
            <Icon name="redeem" size={32} className="opacity-40" />
            <span>Chưa có chương trình khuyến mãi nào</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Tên KM</th>
                  <th className="px-3 py-2 text-left font-medium">Loại</th>
                  <th className="px-3 py-2 text-left font-medium">Kênh</th>
                  <th className="px-3 py-2 text-right font-medium">Lượt dùng</th>
                  <th className="px-3 py-2 text-right font-medium">TB giảm/đơn</th>
                  <th className="px-3 py-2 text-right font-medium">Tổng giảm</th>
                  <th className="px-3 py-2 text-right font-medium">Trị giá quà</th>
                  <th className="px-3 py-2 text-right font-medium">DT đơn KM</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr
                    key={row.promotionId}
                    className={cn(
                      "border-b hover:bg-muted/30 transition-colors",
                      row.invoiceCount === 0 && "opacity-50",
                    )}
                  >
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{row.name}</span>
                        {row.usageLimit !== null && (
                          <Badge variant="outline" className="text-xs">
                            {row.lifetimeUsageCount}/{row.usageLimit}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {TYPE_LABEL[row.type] ?? row.type}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-xs">
                        {CHANNEL_LABEL[row.channel] ?? row.channel}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.invoiceCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {row.avgDiscountPerInvoice > 0
                        ? formatCurrency(row.avgDiscountPerInvoice)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-status-error font-medium">
                      {row.totalDiscount > 0
                        ? `−${formatCurrency(row.totalDiscount)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-status-info">
                      {row.totalFreeValue > 0
                        ? formatCurrency(row.totalFreeValue)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {row.totalRevenue > 0
                        ? formatCurrency(row.totalRevenue)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
      </div>
    </div>
  );
}
