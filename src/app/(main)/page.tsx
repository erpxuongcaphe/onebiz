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
  AlertTriangle,
  ArrowRight,
  BarChart3,
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
import { cn } from "@/lib/utils";
import Link from "next/link";

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
    positive: true,
  },
  {
    label: "Đơn hàng",
    value: 28,
    icon: ShoppingCart,
    color: "text-blue-600",
    bg: "bg-blue-100",
    change: "+3",
    changeLabel: "vs hôm qua",
    positive: true,
    isCurrency: false,
  },
  {
    label: "Khách hàng mới",
    value: 5,
    icon: Users,
    color: "text-purple-600",
    bg: "bg-purple-100",
    change: "+2",
    changeLabel: "vs hôm qua",
    positive: true,
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
    positive: true,
  },
];

// === Chart data by view mode ===
type ChartView = "day" | "hour" | "weekday";

const revenueByDay = [
  { label: "24/03", value: 38200000 },
  { label: "25/03", value: 42500000 },
  { label: "26/03", value: 35800000 },
  { label: "27/03", value: 48900000 },
  { label: "28/03", value: 52300000 },
  { label: "29/03", value: 61500000 },
  { label: "30/03", value: 45250000 },
];

const revenueByHour = [
  { label: "7h", value: 2100000 },
  { label: "8h", value: 5800000 },
  { label: "9h", value: 7200000 },
  { label: "10h", value: 6500000 },
  { label: "11h", value: 4800000 },
  { label: "12h", value: 3200000 },
  { label: "13h", value: 2800000 },
  { label: "14h", value: 4500000 },
  { label: "15h", value: 5200000 },
  { label: "16h", value: 4900000 },
  { label: "17h", value: 3800000 },
  { label: "18h", value: 2500000 },
  { label: "19h", value: 1800000 },
  { label: "20h", value: 1200000 },
  { label: "21h", value: 850000 },
];

const revenueByWeekday = [
  { label: "Thứ 2", value: 38200000 },
  { label: "Thứ 3", value: 42500000 },
  { label: "Thứ 4", value: 35800000 },
  { label: "Thứ 5", value: 48900000 },
  { label: "Thứ 6", value: 52300000 },
  { label: "Thứ 7", value: 61500000 },
  { label: "CN", value: 45250000 },
];

const CHART_DATA: Record<ChartView, typeof revenueByDay> = {
  day: revenueByDay,
  hour: revenueByHour,
  weekday: revenueByWeekday,
};

// === Orders data ===
const ordersData = [
  { day: "T2", completed: 22, cancelled: 2 },
  { day: "T3", completed: 25, cancelled: 1 },
  { day: "T4", completed: 19, cancelled: 3 },
  { day: "T5", completed: 30, cancelled: 2 },
  { day: "T6", completed: 34, cancelled: 1 },
  { day: "T7", completed: 38, cancelled: 4 },
  { day: "CN", completed: 26, cancelled: 2 },
];

const topProducts = [
  { name: "Cà phê Robusta rang xay", qty: 156, revenue: 13260000 },
  { name: "Cà phê Arabica Cầu Đất", qty: 132, revenue: 15840000 },
  { name: "Cà phê Moka Lâm Đồng", qty: 98, revenue: 13230000 },
  { name: "Trà sen Tây Hồ", qty: 87, revenue: 9570000 },
  { name: "Cà phê sữa 3in1", qty: 76, revenue: 4940000 },
  { name: "Trà đào cam sả", qty: 65, revenue: 2925000 },
  { name: "Cà phê trộn bơ hạt", qty: 54, revenue: 4050000 },
  { name: "Cold Brew túi ngâm", qty: 48, revenue: 4224000 },
  { name: "Matcha latte bột", qty: 43, revenue: 4085000 },
  { name: "Cà phê Honey Process", qty: 38, revenue: 7410000 },
];

const lowStockProducts = [
  { name: "Máy xay cà phê mini", stock: 3, minStock: 5 },
  { name: "Bộ drip cà phê V60", stock: 4, minStock: 10 },
  { name: "Cà phê Cherry đặc biệt", stock: 5, minStock: 15 },
  { name: "Sữa đặc Ông Thọ thùng", stock: 6, minStock: 10 },
  { name: "Cà phê Honey Process", stock: 8, minStock: 15 },
];

const recentActivities = [
  { name: "Nguyễn Văn A", action: "tạo hóa đơn HD005023", time: "5 phút trước", icon: FileText },
  { name: "Trần Thị B", action: "nhập hàng PN001005", time: "12 phút trước", icon: Package },
  { name: "Lê Văn C", action: "tạo hóa đơn HD005024", time: "25 phút trước", icon: FileText },
  { name: "Phạm Thị D", action: "cập nhật giá SP0042", time: "1 giờ trước", icon: Package },
  { name: "Hoàng Văn E", action: "tạo đơn hàng DH003091", time: "1 giờ trước", icon: ShoppingCart },
  { name: "Nguyễn Thị F", action: "thêm khách hàng KH00892", time: "2 giờ trước", icon: Users },
  { name: "Đỗ Văn G", action: "xuất kho XK000412", time: "3 giờ trước", icon: Package },
  { name: "Vũ Thị H", action: "tạo hóa đơn HD005025", time: "4 giờ trước", icon: FileText },
];

// Custom tooltips
function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-blue-600">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function OrdersTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
          {entry.dataKey === "completed" ? "Hoàn thành" : "Đã hủy"}:{" "}
          <span className="font-bold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function TongQuanPage() {
  const [dateRange, setDateRange] = useState<"today" | "week" | "month">("today");
  const [chartView, setChartView] = useState<ChartView>("day");

  const today = new Date();
  const formattedDate = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(today);

  const chartData = CHART_DATA[chartView];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Date selector row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground capitalize">{formattedDate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {(
            [
              { key: "today", label: "Hôm nay" },
              { key: "week", label: "Tuần này" },
              { key: "month", label: "Tháng này" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              onClick={() => setDateRange(item.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                dateRange === item.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiData.map((kpi) => {
          const Icon = kpi.icon;
          const isCurrency = kpi.isCurrency !== false;
          return (
            <Card key={kpi.label}>
              <CardContent className="pt-0">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="text-xl lg:text-2xl font-bold">
                      {isCurrency ? formatCurrency(kpi.value) : kpi.value.toLocaleString("vi-VN")}
                    </p>
                    {kpi.change && (
                      <p className={cn("text-[11px]", kpi.positive ? "text-green-600" : "text-red-500")}>
                        {kpi.change}{" "}
                        <span className="text-muted-foreground">{kpi.changeLabel}</span>
                      </p>
                    )}
                  </div>
                  <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", kpi.bg)}>
                    <Icon className={cn("size-5", kpi.color)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue chart with view toggle */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Biểu đồ doanh thu</CardTitle>
              <div className="flex items-center bg-muted rounded-md overflow-hidden">
                {(
                  [
                    { key: "day", label: "Ngày" },
                    { key: "hour", label: "Giờ" },
                    { key: "weekday", label: "Thứ" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setChartView(v.key)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium transition-colors",
                      chartView === v.key
                        ? "bg-primary text-white"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v: number) => formatChartCurrency(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50} />
                  <Tooltip content={<RevenueTooltip />} />
                  <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#revenueGradient)" name="Doanh thu" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Orders BarChart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Đơn hàng theo trạng thái</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ordersData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip content={<OrdersTooltip />} />
                  <Legend formatter={(value: string) => (value === "completed" ? "Hoàn thành" : "Đã hủy")} />
                  <Bar dataKey="completed" fill="#22c55e" radius={[4, 4, 0, 0]} name="completed" />
                  <Bar dataKey="cancelled" fill="#ef4444" radius={[4, 4, 0, 0]} name="cancelled" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3-column: Top products, Low stock alerts, Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top 10 sản phẩm */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Top sản phẩm bán chạy</CardTitle>
              <Link href="/phan-tich/hang-hoa" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Xem thêm <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topProducts.slice(0, 7).map((product, index) => (
                <div key={product.name} className="flex items-center gap-2.5 py-1">
                  <span className={cn(
                    "size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                    index < 3 ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {index + 1}
                  </span>
                  <span className="text-sm flex-1 truncate">{product.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{product.qty} sp</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Low stock alerts */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-amber-500" />
                Hàng sắp hết
              </CardTitle>
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {lowStockProducts.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {lowStockProducts.map((product) => (
                <div key={product.name} className="flex items-center justify-between py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{product.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Cảnh báo: dưới {product.minStock}
                    </p>
                  </div>
                  <Badge variant="destructive" className="text-xs shrink-0 ml-2">
                    Còn {product.stock}
                  </Badge>
                </div>
              ))}
              <Link href="/hang-hoa" className="text-xs text-primary hover:underline flex items-center gap-0.5 pt-1">
                Quản lý tồn kho <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recent activities */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Hoạt động gần đây</CardTitle>
              <Link href="/phan-tich" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                <BarChart3 className="size-3" /> Phân tích
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivities.slice(0, 6).map((activity, index) => {
                const Icon = activity.icon;
                return (
                  <div key={index} className="flex items-start gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">
                        <span className="font-medium">{activity.name}</span>{" "}
                        <span className="text-muted-foreground">{activity.action}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">{activity.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
