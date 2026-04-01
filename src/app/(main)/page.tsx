"use client";

import { useState } from "react";
import {
  TrendingUp,
  ShoppingCart,
  Users,
  DollarSign,
  Package,
  FileText,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { DateRange } from "@/lib/types";

// === KPI Data ===
const kpiData = [
  {
    label: "Doanh thu",
    value: 45250000,
    icon: TrendingUp,
    color: "text-green-600",
    bg: "bg-green-100",
    change: "+12.5%",
    changeLabel: "vs hôm qua",
    changeColor: "text-green-600",
  },
  {
    label: "Đơn hàng",
    value: 28,
    icon: ShoppingCart,
    color: "text-blue-600",
    bg: "bg-blue-100",
    change: "+3",
    changeLabel: "vs hôm qua",
    changeColor: "text-blue-600",
    isCurrency: false,
  },
  {
    label: "Khách hàng mới",
    value: 5,
    icon: Users,
    color: "text-purple-600",
    bg: "bg-purple-100",
    change: "",
    changeLabel: "",
    changeColor: "",
    isCurrency: false,
  },
  {
    label: "Lợi nhuận",
    value: 18500000,
    icon: DollarSign,
    color: "text-orange-600",
    bg: "bg-orange-100",
    change: "+8.2%",
    changeLabel: "vs hôm qua",
    changeColor: "text-green-600",
  },
];

// === 7-day revenue data ===
const revenueData = [
  { day: "T2 (24/03)", revenue: 38200000 },
  { day: "T3 (25/03)", revenue: 42500000 },
  { day: "T4 (26/03)", revenue: 35800000 },
  { day: "T5 (27/03)", revenue: 48900000 },
  { day: "T6 (28/03)", revenue: 52300000 },
  { day: "T7 (29/03)", revenue: 61500000 },
  { day: "CN (30/03)", revenue: 45250000 },
];

// === 7-day orders data ===
const ordersData = [
  { day: "T2", hoànThành: 22, đãHủy: 2 },
  { day: "T3", hoànThành: 25, đãHủy: 1 },
  { day: "T4", hoànThành: 19, đãHủy: 3 },
  { day: "T5", hoànThành: 30, đãHủy: 2 },
  { day: "T6", hoànThành: 34, đãHủy: 1 },
  { day: "T7", hoànThành: 38, đãHủy: 4 },
  { day: "CN", hoànThành: 26, đãHủy: 2 },
];

const topProducts = [
  { name: "Cà phê sữa đá", qty: 156, revenue: 7800000 },
  { name: "Bạc xỉu", qty: 132, revenue: 6600000 },
  { name: "Cà phê đen đá", qty: 98, revenue: 3920000 },
  { name: "Trà sen vàng", qty: 87, revenue: 4350000 },
  { name: "Cà phê muối", qty: 76, revenue: 3800000 },
  { name: "Trà đào cam sả", qty: 65, revenue: 3250000 },
  { name: "Phindi kem sữa", qty: 54, revenue: 2970000 },
  { name: "Cà phê coconut", qty: 48, revenue: 2640000 },
  { name: "Trà sữa trân châu", qty: 43, revenue: 2150000 },
  { name: "Cà phê caramel", qty: 38, revenue: 2090000 },
];

const recentActivities = [
  {
    name: "Nguyễn Văn A",
    action: "tạo hóa đơn HD005023",
    time: "5 phút trước",
    icon: FileText,
  },
  {
    name: "Trần Thị B",
    action: "nhập hàng PN001005",
    time: "12 phút trước",
    icon: Package,
  },
  {
    name: "Lê Văn C",
    action: "tạo hóa đơn HD005024",
    time: "25 phút trước",
    icon: FileText,
  },
  {
    name: "Phạm Thị D",
    action: "cập nhật giá sản phẩm SP0042",
    time: "1 giờ trước",
    icon: Package,
  },
  {
    name: "Hoàng Văn E",
    action: "tạo đơn hàng DH003091",
    time: "1 giờ trước",
    icon: ShoppingCart,
  },
  {
    name: "Nguyễn Thị F",
    action: "thêm khách hàng KH00892",
    time: "2 giờ trước",
    icon: Users,
  },
  {
    name: "Đỗ Văn G",
    action: "xuất kho XK000412",
    time: "3 giờ trước",
    icon: Package,
  },
  {
    name: "Vũ Thị H",
    action: "tạo hóa đơn HD005025",
    time: "4 giờ trước",
    icon: FileText,
  },
];

// Custom tooltip for revenue chart
function RevenueTooltip({
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
      <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-blue-600">
        Doanh thu: {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

// Custom tooltip for orders chart
function OrdersTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
          {entry.dataKey === "hoànThành" ? "Hoàn thành" : "Đã hủy"}:{" "}
          <span className="font-bold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function TongQuanPage() {
  const [dateRange, setDateRange] = useState<DateRange>("today");

  const today = new Date();
  const formattedDate = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(today);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Date selector row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground capitalize">
            {formattedDate}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDateRange("today")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              dateRange === "today"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Hôm nay
          </button>
          <button
            onClick={() => setDateRange("week")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              dateRange === "week"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Tuần này
          </button>
          <button
            onClick={() => setDateRange("month")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              dateRange === "month"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Tháng này
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiData.map((kpi) => {
          const Icon = kpi.icon;
          const isCurrency = kpi.isCurrency !== false;
          return (
            <Card key={kpi.label}>
              <CardContent className="pt-0">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{kpi.label}</p>
                    <p className="text-2xl font-bold">
                      {isCurrency
                        ? formatCurrency(kpi.value)
                        : kpi.value.toLocaleString("vi-VN")}
                    </p>
                    {kpi.change && (
                      <p className={`text-xs ${kpi.changeColor}`}>
                        {kpi.change}{" "}
                        <span className="text-muted-foreground">
                          {kpi.changeLabel}
                        </span>
                      </p>
                    )}
                  </div>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${kpi.bg}`}
                  >
                    <Icon className={`h-5 w-5 ${kpi.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue AreaChart */}
        <Card>
          <CardHeader>
            <CardTitle>Doanh thu 7 ngày gần nhất</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={revenueData}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatChartCurrency(v)}
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip content={<RevenueTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#revenueGradient)"
                    name="Doanh thu"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Orders BarChart */}
        <Card>
          <CardHeader>
            <CardTitle>Đơn hàng theo trạng thái</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ordersData}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip content={<OrdersTooltip />} />
                  <Legend
                    formatter={(value: string) =>
                      value === "hoànThành" ? "Hoàn thành" : "Đã hủy"
                    }
                  />
                  <Bar
                    dataKey="hoànThành"
                    fill="#22c55e"
                    radius={[4, 4, 0, 0]}
                    name="hoànThành"
                  />
                  <Bar
                    dataKey="đãHủy"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                    name="đãHủy"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top products & Recent activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top 10 san pham ban chay */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 sản phẩm bán chạy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-2 font-medium">#</th>
                    <th className="pb-2 pr-2 font-medium">Tên hàng</th>
                    <th className="pb-2 pr-2 font-medium text-right">
                      SL bán
                    </th>
                    <th className="pb-2 font-medium text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product, index) => (
                    <tr
                      key={product.name}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="py-2 pr-2 text-muted-foreground">
                        {index + 1}
                      </td>
                      <td className="py-2 pr-2 font-medium">{product.name}</td>
                      <td className="py-2 pr-2 text-right">{product.qty}</td>
                      <td className="py-2 text-right">
                        {formatCurrency(product.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Hoat dong gan day */}
        <Card>
          <CardHeader>
            <CardTitle>Hoạt động gần đây</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {activity.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{activity.name}</span>{" "}
                      {activity.action}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {activity.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
