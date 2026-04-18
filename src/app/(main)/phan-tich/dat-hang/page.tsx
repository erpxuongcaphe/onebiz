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
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import { useBranchFilter } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
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
  const { activeBranchId } = useBranchFilter();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<OrdersKpis | null>(null);
  const [orderVolume, setOrderVolume] = useState<ChartPoint[]>([]);
  const [orderStatus, setOrderStatus] = useState<OrderStatusItem[]>([]);
  const [recentOrdersList, setRecentOrdersList] = useState<RecentOrder[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [kpisData, volumeData, statusData, ordersData] = await Promise.all([
        getOrdersKpis(activeBranchId),
        getDailyOrderVolume(30, activeBranchId),
        getOrderStatusDistribution(activeBranchId),
        getRecentOrders(10, activeBranchId),
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
  }, [activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <DateRangeBar
          title="Phân tích đặt hàng"
          subtitle="Theo dõi tình trạng và hiệu suất đơn hàng"
        />
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
      value: kpis ? kpis.total.toLocaleString("vi-VN") : "0",
      change: totalChange.text,
      positive: totalChange.positive,
      icon: "assignment",
      bg: "bg-primary-fixed",
      iconColor: "text-primary",
      valueColor: "text-foreground",
    },
    {
      label: "Đơn hoàn thành",
      value: kpis ? kpis.completed.toLocaleString("vi-VN") : "0",
      change: kpis ? `${kpis.completedPct}% tổng đơn` : "",
      positive: true,
      icon: "check_circle",
      bg: "bg-status-success/10",
      iconColor: "text-status-success",
      valueColor: "text-foreground",
    },
    {
      label: "Đơn đang xử lý",
      value: kpis ? kpis.inTransit.toLocaleString("vi-VN") : "0",
      change: kpis ? `${kpis.inTransitPct}% tổng đơn` : "",
      positive: true,
      icon: "local_shipping",
      bg: "bg-status-warning/10",
      iconColor: "text-status-warning",
      valueColor: "text-foreground",
    },
    {
      label: "Đơn hủy",
      value: kpis ? kpis.cancelled.toLocaleString("vi-VN") : "0",
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
      <DateRangeBar
        title="Phân tích đặt hàng"
        subtitle="Theo dõi tình trạng và hiệu suất đơn hàng"
      />

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
                      <td className="py-2.5 pr-4 font-mono text-xs font-medium text-primary">
                        {order.code}
                      </td>
                      <td className="py-2.5 pr-4 font-medium">{order.customer}</td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[order.status] ?? ""}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium">
                        {formatCurrency(order.value)}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground text-xs">
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
