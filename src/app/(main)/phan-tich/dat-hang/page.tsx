"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getOrdersKpis,
  getDailyOrderVolume,
  getOrderStatusDistribution,
  getRecentOrders,
} from "@/lib/services";
import type {
  ChartPoint,
  OrderStatusItem,
  RecentOrder,
} from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";

// === Types ===

interface OrdersKpis {
  total: number;
  prevTotal: number;
  completed: number;
  completedPct: number;
  inTransit: number;
  inTransitPct: number;
  cancelled: number;
  cancelledPct: number;
}

// === Helpers ===

function calcChangePct(
  current: number,
  previous: number
): { text: string; positive: boolean } {
  if (previous === 0) {
    return current > 0
      ? { text: "+100%", positive: true }
      : { text: "0%", positive: true };
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}% so với tháng trước`,
    positive: pct >= 0,
  };
}

// === Constants ===

const STATUS_COLORS = ["#16a34a", "#eab308", "#f97316", "#ef4444"];

const STATUS_BADGE: Record<string, string> = {
  "Hoàn thành": "bg-status-success/10 text-status-success",
  "Đang xử lý": "bg-status-warning/10 text-status-warning",
  "Chờ xử lý": "bg-status-warning/10 text-status-warning",
  "Đang giao": "bg-status-warning/10 text-status-warning",
  "Đã xác nhận": "bg-primary-fixed text-primary",
  "Nháp": "bg-muted text-foreground",
  "Đã hủy": "bg-status-error/10 text-status-error",
};

// === Tooltips ===

function OrderVolumeTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">Ngày {label}</p>
      <p className="text-sm font-bold text-primary">
        {payload[0].value} đơn hàng
      </p>
    </div>
  );
}

function StatusPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{payload[0].name}</p>
      <p className="text-sm font-bold">{payload[0].value} đơn</p>
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
  if (percent < 0.05) return null;
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

// === Page ===

export default function DatHangPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<OrdersKpis | null>(null);
  const [orderVolume, setOrderVolume] = useState<ChartPoint[]>([]);
  const [orderStatus, setOrderStatus] = useState<OrderStatusItem[]>([]);
  const [recentOrdersList, setRecentOrdersList] = useState<RecentOrder[]>([]);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  // ── Export Excel — view (1 sheet) + full (multi-sheet) ──
  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO ĐẶT HÀNG",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = {
        name: "KPI đặt hàng",
        titleRows: title,
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 28 },
          { label: "Giá trị", key: "value", width: 16, format: "number" },
          { label: "% tổng", key: "pct", width: 12 },
        ],
        rows: [
          { metric: "Tổng đơn hàng", value: kpis?.total ?? 0, pct: "100%" },
          {
            metric: "Đơn hoàn thành",
            value: kpis?.completed ?? 0,
            pct: kpis ? `${kpis.completedPct}%` : "0%",
          },
          {
            metric: "Đơn đang xử lý",
            value: kpis?.inTransit ?? 0,
            pct: kpis ? `${kpis.inTransitPct}%` : "0%",
          },
          {
            metric: "Đơn huỷ",
            value: kpis?.cancelled ?? 0,
            pct: kpis ? `${kpis.cancelledPct}%` : "0%",
          },
        ],
      };
      exportReportToExcel({
        kind: "dat-hang",
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
  }, [kpis, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO ĐẶT HÀNG — ĐẦY ĐỦ",
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
            { label: "Giá trị", key: "value", width: 16, format: "number" },
            { label: "% tổng", key: "pct", width: 12 },
          ],
          rows: [
            { metric: "Tổng đơn", value: kpis?.total ?? 0, pct: "100%" },
            { metric: "Hoàn thành", value: kpis?.completed ?? 0, pct: `${kpis?.completedPct ?? 0}%` },
            { metric: "Đang xử lý", value: kpis?.inTransit ?? 0, pct: `${kpis?.inTransitPct ?? 0}%` },
            { metric: "Đã huỷ", value: kpis?.cancelled ?? 0, pct: `${kpis?.cancelledPct ?? 0}%` },
          ],
        },
        {
          name: "Theo ngày",
          titleRows: ["SỐ LƯỢNG ĐƠN THEO NGÀY", ...title.slice(1)],
          columns: [
            { label: "Ngày", key: "label", width: 14 },
            { label: "Số đơn", key: "value", width: 12, format: "number" },
          ],
          rows: orderVolume.map((p) => ({ label: p.label, value: p.value })),
          footer: {
            label: "TỔNG",
            value: orderVolume.reduce((s, p) => s + p.value, 0),
          },
        },
        {
          name: "Theo trạng thái",
          titleRows: ["PHÂN BỔ TRẠNG THÁI", ...title.slice(1)],
          columns: [
            { label: "Trạng thái", key: "name", width: 20 },
            { label: "Số đơn", key: "value", width: 12, format: "number" },
          ],
          rows: orderStatus.map((s) => ({ name: s.name, value: s.value })),
        },
        {
          name: "Đơn gần đây",
          titleRows: ["10 ĐƠN GẦN NHẤT", ...title.slice(1)],
          columns: [
            { label: "Mã ĐH", key: "code", width: 16 },
            { label: "Khách hàng", key: "customer", width: 28 },
            { label: "Trạng thái", key: "status", width: 16 },
            { label: "Giá trị (VND)", key: "value", width: 16, format: "currency" },
            { label: "Ngày", key: "date", width: 14 },
          ],
          rows: recentOrdersList.map((o) => ({
            code: o.code,
            customer: o.customer,
            status: o.status,
            value: o.value,
            date: o.date,
          })),
        },
      ];
      exportReportToExcel({
        kind: "dat-hang",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({
        title: "Đã xuất Excel (đầy đủ)",
        description: "4 sheet: KPI + Theo ngày + Theo trạng thái + Đơn gần đây.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [kpis, orderVolume, orderStatus, recentOrdersList, range, branchLabel, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Phân tích đặt hàng"
      subtitle="Theo dõi tình trạng và hiệu suất đơn hàng"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || !kpis}
    />
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [kpisData, volumeData, statusData, ordersData] = await Promise.all([
        getOrdersKpis(activeBranchId, range),
        getDailyOrderVolume(30, activeBranchId, range),
        getOrderStatusDistribution(activeBranchId, range),
        getRecentOrders(10, activeBranchId, range),
      ]);
      setKpis(kpisData);
      setOrderVolume(volumeData);
      setOrderStatus(statusData);
      setRecentOrdersList(ordersData);
    } catch (err) {
      console.error("Failed to fetch order analytics:", err);
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

  const totalChange = kpis
    ? calcChangePct(kpis.total, kpis.prevTotal)
    : { text: "", positive: true };

  const kpiCards = [
    {
      label: "Tổng đơn hàng",
      value: kpis ? formatNumber(kpis.total) : "0",
      change: totalChange.text,
      positive: totalChange.positive,
      icon: "assignment",
      bg: "bg-primary-fixed",
      iconColor: "text-primary",
      valueColor: "text-foreground",
    },
    {
      label: "Đơn hoàn thành",
      value: kpis ? formatNumber(kpis.completed) : "0",
      change: kpis ? `${kpis.completedPct}% tổng đơn` : "",
      positive: true,
      icon: "check_circle",
      bg: "bg-status-success/10",
      iconColor: "text-status-success",
      valueColor: "text-foreground",
    },
    {
      label: "Đơn đang xử lý",
      value: kpis ? formatNumber(kpis.inTransit) : "0",
      change: kpis ? `${kpis.inTransitPct}% tổng đơn` : "",
      positive: true,
      icon: "local_shipping",
      bg: "bg-status-warning/10",
      iconColor: "text-status-warning",
      valueColor: "text-foreground",
    },
    {
      label: "Đơn hủy",
      value: kpis ? formatNumber(kpis.cancelled) : "0",
      change: kpis ? `${kpis.cancelledPct}% tổng đơn` : "",
      positive: false,
      icon: "cancel",
      bg: "bg-status-error/10",
      iconColor: "text-status-error",
      valueColor: "text-foreground",
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>

        {/* Order volume line chart */}
        <ChartCard
          title="Số lượng đơn hàng theo ngày"
          subtitle="30 ngày gần nhất"
        >
          {orderVolume.length > 0 ? (
            <div className="h-48 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={orderVolume}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={35}
                  />
                  <Tooltip content={<OrderVolumeTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#004AC6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, fill: "#004AC6" }}
                    name="Đơn hàng"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 md:h-72 flex items-center justify-center text-muted-foreground text-sm">
              Chưa có dữ liệu đơn hàng
            </div>
          )}
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Order status pie chart */}
          <ChartCard
            title="Phân bổ trạng thái đơn hàng"
            subtitle="Tháng hiện tại"
          >
            {orderStatus.length > 0 ? (
              <div className="h-64 md:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={orderStatus}
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
                      {orderStatus.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={STATUS_COLORS[index % STATUS_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<StatusPieTooltip />} />
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
              <div className="h-64 md:h-80 flex items-center justify-center text-muted-foreground text-sm">
                Chưa có dữ liệu trạng thái
              </div>
            )}
          </ChartCard>

          {/* Placeholder for removed processing time chart */}
          <ChartCard
            title="Thời gian xử lý đơn trung bình"
            subtitle="Tính năng đang phát triển"
          >
            <div className="h-64 md:h-80 flex flex-col items-center justify-center text-muted-foreground">
              <Icon name="assignment" className="size-10 mb-3 opacity-30" />
              <p className="text-sm">Dữ liệu thời gian xử lý chưa khả dụng</p>
              <p className="text-xs mt-1">Tính năng sẽ được cập nhật sau</p>
            </div>
          </ChartCard>
        </div>

        {/* Recent orders table */}
        <ChartCard title="Đơn hàng gần đây" subtitle="10 đơn mới nhất">
          {recentOrdersList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Mã ĐH</th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Khách hàng
                    </th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Trạng thái
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">Giá trị</th>
                    <th className="text-right py-2 font-medium">Ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrdersList.map((order) => (
                    <tr key={order.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs font-medium text-primary">
                        {order.code}
                      </td>
                      <td className="py-3 pr-4 font-medium">{order.customer}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[order.status] ?? ""}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right font-medium">
                        {formatCurrency(order.value)}
                      </td>
                      <td className="py-3 text-right text-muted-foreground text-xs">
                        {order.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Chưa có đơn hàng nào
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
