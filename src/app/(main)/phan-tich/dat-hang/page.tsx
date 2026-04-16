"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardList,
  CheckCircle,
  Truck,
  XCircle,
} from "lucide-react";
import { Loader2 } from "lucide-react";
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
  "Hoàn thành": "bg-green-100 text-green-700",
  "Đang xử lý": "bg-yellow-100 text-yellow-700",
  "Chờ xử lý": "bg-yellow-100 text-yellow-700",
  "Đang giao": "bg-orange-100 text-orange-700",
  "Đã xác nhận": "bg-blue-100 text-blue-700",
  "Nháp": "bg-gray-100 text-gray-700",
  "Đã hủy": "bg-red-100 text-red-600",
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
      <p className="text-sm font-bold text-blue-600">
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
      <div className="flex flex-col h-[calc(100vh-48px)]">
        <DateRangeBar
          title="Phân tích đặt hàng"
          subtitle="Theo dõi tình trạng và hiệu suất đơn hàng"
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
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
      icon: ClipboardList,
      bg: "bg-blue-50",
      iconColor: "text-blue-600",
      valueColor: "text-blue-700",
    },
    {
      label: "Đơn hoàn thành",
      value: kpis ? kpis.completed.toLocaleString("vi-VN") : "0",
      change: kpis ? `${kpis.completedPct}% tổng đơn` : "",
      positive: true,
      icon: CheckCircle,
      bg: "bg-green-50",
      iconColor: "text-green-600",
      valueColor: "text-green-700",
    },
    {
      label: "Đơn đang xử lý",
      value: kpis ? kpis.inTransit.toLocaleString("vi-VN") : "0",
      change: kpis ? `${kpis.inTransitPct}% tổng đơn` : "",
      positive: true,
      icon: Truck,
      bg: "bg-orange-50",
      iconColor: "text-orange-600",
      valueColor: "text-orange-700",
    },
    {
      label: "Đơn hủy",
      value: kpis ? kpis.cancelled.toLocaleString("vi-VN") : "0",
      change: kpis ? `${kpis.cancelledPct}% tổng đơn` : "",
      positive: false,
      icon: XCircle,
      bg: "bg-red-50",
      iconColor: "text-red-500",
      valueColor: "text-red-600",
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
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
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, fill: "#2563eb" }}
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
              <ClipboardList className="size-10 mb-3 opacity-30" />
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
