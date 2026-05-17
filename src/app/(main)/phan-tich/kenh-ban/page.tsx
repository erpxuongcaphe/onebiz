"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import {
  formatCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getChannelRevenue,
  getChannelPerformance,
} from "@/lib/services";
import type { ChartPoint } from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";

type ChannelPerformanceRow = {
  channel: string;
  revenue: number;
  orders: number;
  avgValue: number;
};

const CHANNEL_COLORS = ["#004AC6", "#6366f1", "#0ea5e9", "#9333ea", "#f59e0b", "#10b981"];

const CHANNEL_ICONS: Record<string, string> = {
  "Tại quầy": "shopping_cart",
  "Facebook": "public",
  "Zalo": "chat_bubble",
  "Website": "desktop_windows",
};

const CHANNEL_STYLES: Record<string, { bg: string; iconColor: string; valueColor: string }> = {
  "Tại quầy": { bg: "bg-primary-fixed", iconColor: "text-primary", valueColor: "text-primary" },
  "Facebook": { bg: "bg-status-info/10", iconColor: "text-status-info", valueColor: "text-status-info" },
  "Zalo": { bg: "bg-status-info/10", iconColor: "text-status-info", valueColor: "text-status-info" },
  "Website": { bg: "bg-status-info/10", iconColor: "text-status-info", valueColor: "text-status-info" },
};

const DEFAULT_STYLE = { bg: "bg-surface-container-low", iconColor: "text-foreground", valueColor: "text-foreground" };

// === Tooltips ===

function ChannelPieTooltip({
  active,
  payload,
  totalRevenue,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
  totalRevenue: number;
}) {
  if (!active || !payload?.length) return null;
  const pct = totalRevenue > 0 ? ((payload[0].value / totalRevenue) * 100).toFixed(1) : "0";
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{payload[0].name}</p>
      <p className="text-sm font-bold">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
      <p className="text-xs text-muted-foreground">{pct}% tổng doanh thu</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPieLabel(props: any) {
  const cx = props.cx as number;
  const cy = props.cy as number;
  const midAngle = (props.midAngle as number) ?? 0;
  const innerRadius = props.innerRadius as number;
  const outerRadius = props.outerRadius as number;
  const percent = (props.percent as number) ?? 0;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.06) return null;
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function KenhBanPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [channelRevenue, setChannelRevenue] = useState<ChartPoint[]>([]);
  const [channelPerformance, setChannelPerformance] = useState<ChannelPerformanceRow[]>([]);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO KÊNH BÁN",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = {
        name: "Kênh bán",
        titleRows: title,
        columns: [
          { label: "Kênh", key: "channel", width: 20 },
          { label: "Số đơn", key: "orders", width: 12, format: "number" },
          { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          { label: "TB/đơn (VND)", key: "avgValue", width: 16, format: "currency" },
        ],
        rows: channelPerformance.map((c) => ({
          channel: c.channel,
          orders: c.orders,
          revenue: c.revenue,
          avgValue: c.avgValue,
        })),
        footer: {
          channel: "TỔNG",
          orders: channelPerformance.reduce((s, c) => s + c.orders, 0),
          revenue: channelPerformance.reduce((s, c) => s + c.revenue, 0),
          avgValue: "",
        },
      };
      exportReportToExcel({
        kind: "kenh-ban",
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
  }, [channelPerformance, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO KÊNH BÁN — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        {
          name: "Hiệu suất kênh",
          titleRows: title,
          columns: [
            { label: "Kênh", key: "channel", width: 20 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
            { label: "TB/đơn (VND)", key: "avgValue", width: 16, format: "currency" },
          ],
          rows: channelPerformance.map((c) => ({
            channel: c.channel,
            orders: c.orders,
            revenue: c.revenue,
            avgValue: c.avgValue,
          })),
          footer: {
            channel: "TỔNG",
            orders: channelPerformance.reduce((s, c) => s + c.orders, 0),
            revenue: channelPerformance.reduce((s, c) => s + c.revenue, 0),
            avgValue: "",
          },
        },
        {
          name: "DT theo kênh (pie)",
          titleRows: ["DOANH THU THEO KÊNH", ...title.slice(1)],
          columns: [
            { label: "Kênh", key: "label", width: 20 },
            { label: "Doanh thu (VND)", key: "value", width: 18, format: "currency" },
          ],
          rows: channelRevenue.map((c) => ({ label: c.label, value: c.value })),
        },
      ];
      exportReportToExcel({
        kind: "kenh-ban",
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
  }, [channelPerformance, channelRevenue, range, branchLabel, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Phân tích kênh bán"
      subtitle="So sánh hiệu suất các kênh bán hàng"
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
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [revenueRes, perfRes] = await Promise.all([
        getChannelRevenue(activeBranchId, range),
        getChannelPerformance(activeBranchId, range),
      ]);
      setChannelRevenue(revenueRes);
      setChannelPerformance(perfRes);
    } catch (err) {
      console.error("Failed to fetch channel analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon name="progress_activity" className="size-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Derive KPI cards from channelPerformance
  const kpiCards = channelPerformance.map((row) => {
    const style = CHANNEL_STYLES[row.channel] ?? DEFAULT_STYLE;
    const icon = CHANNEL_ICONS[row.channel] ?? "desktop_windows";
    return {
      label: row.channel,
      value: formatCurrency(row.revenue),
      change: `${row.orders} đơn hàng`,
      positive: true,
      icon,
      ...style,
    };
  });

  // Pie chart data: map ChartPoint { label, value } to { name, value }
  const pieData = channelRevenue.map((p) => ({ name: p.label, value: p.value }));
  const totalRevenue = pieData.reduce((s, c) => s + c.value, 0);

  // Table totals
  const totalOrders = channelPerformance.reduce((s, r) => s + r.orders, 0);
  const totalRev = channelPerformance.reduce((s, r) => s + r.revenue, 0);
  const totalAvg = totalOrders > 0 ? Math.round(totalRev / totalOrders) : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        {kpiCards.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpiCards.map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu kênh bán trong tháng này.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue by channel pie chart */}
          <ChartCard
            title="Doanh thu theo kênh bán"
            subtitle="Tháng hiện tại"
          >
            {pieData.length > 0 ? (
              <div className="h-64 md:h-80">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderPieLabel}
                      outerRadius="80%"
                      dataKey="value"
                      nameKey="name"
                      strokeWidth={2}
                      stroke="#fff"
                    >
                      {pieData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={CHANNEL_COLORS[index % CHANNEL_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChannelPieTooltip totalRevenue={totalRevenue} />} />
                    <Legend
                      verticalAlign="bottom"
                      formatter={(value: string) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 md:h-80 flex items-center justify-center text-sm text-muted-foreground">
                Chưa có dữ liệu doanh thu.
              </div>
            )}
          </ChartCard>

          {/* Historical trend placeholder */}
          <ChartCard
            title="Xu hướng theo kênh"
            subtitle="Dữ liệu lịch sử"
          >
            <div className="h-64 md:h-80 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Icon name="info" className="size-8" />
              <p className="text-sm text-center px-4">
                Biểu đồ xu hướng theo tháng sẽ được bổ sung khi có đủ dữ liệu lịch sử.
              </p>
            </div>
          </ChartCard>
        </div>

        {/* Channel performance table */}
        <ChartCard
          title="Hiệu suất theo kênh bán"
          subtitle="Tháng hiện tại"
        >
          {channelPerformance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Kênh</th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Doanh thu
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Đơn hàng
                    </th>
                    <th className="text-right py-2 font-medium">Giá trị TB</th>
                  </tr>
                </thead>
                <tbody>
                  {channelPerformance.map((row) => (
                    <tr key={row.channel} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{row.channel}</td>
                      <td className="py-3 pr-4 text-right font-medium text-primary">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="py-3 pr-4 text-right">{row.orders}</td>
                      <td className="py-3 text-right text-muted-foreground">
                        {formatCurrency(row.avgValue)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-semibold">
                    <td className="py-3 pr-4">Tổng cộng</td>
                    <td className="py-3 pr-4 text-right text-primary">
                      {formatCurrency(totalRev)}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      {totalOrders}
                    </td>
                    <td className="py-3 text-right text-muted-foreground">
                      {formatCurrency(totalAvg)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có dữ liệu hiệu suất kênh bán.
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
