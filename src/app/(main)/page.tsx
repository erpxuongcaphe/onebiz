"use client";

import { useState, useEffect, useCallback } from "react";
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
  Loader2,
  Plus,
  ArrowLeftRight,
  Receipt,
  Boxes,
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
import {
  getDashboardKpis,
  getRevenueByDay,
  getRevenueByHour,
  getRevenueByWeekday,
  getOrdersByWeekday,
  getTopProducts,
  getLowStockProducts,
  getRecentActivities,
  getFinancialAlerts,
} from "@/lib/services";
import type {
  DashboardKpis,
  ChartPoint,
  OrderChartPoint,
  TopProduct,
  LowStockProduct,
  RecentActivity,
} from "@/lib/services/supabase/dashboard";
import type { FinancialAlert } from "@/lib/services/supabase/reports";
import { getInventoryTurnover } from "@/lib/services/supabase/reports";
import type { InventoryTurnoverResult } from "@/lib/services/supabase/reports";
import { Button } from "@/components/ui/button";

type ChartView = "day" | "hour" | "weekday";

const ENTITY_ICONS: Record<string, typeof FileText> = {
  invoice: FileText,
  product: Package,
  customer: Users,
  purchase_order: Package,
  cash_transaction: DollarSign,
};

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

function calcChange(current: number, previous: number): { text: string; positive: boolean } {
  if (previous === 0) return { text: current > 0 ? "+100%" : "0%", positive: current >= 0 };
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(1)}%`, positive: pct >= 0 };
}

function calcDiff(current: number, previous: number): { text: string; positive: boolean } {
  const diff = current - previous;
  const sign = diff >= 0 ? "+" : "";
  return { text: `${sign}${diff}`, positive: diff >= 0 };
}

export default function TongQuanPage() {
  const [chartView, setChartView] = useState<ChartView>("day");
  const [loading, setLoading] = useState(true);

  // Data state
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [revenueDay, setRevenueDay] = useState<ChartPoint[]>([]);
  const [revenueHour, setRevenueHour] = useState<ChartPoint[]>([]);
  const [revenueWeekday, setRevenueWeekday] = useState<ChartPoint[]>([]);
  const [orders, setOrders] = useState<OrderChartPoint[]>([]);
  const [topProds, setTopProds] = useState<TopProduct[]>([]);
  const [lowStock, setLowStock] = useState<LowStockProduct[]>([]);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [financialAlerts, setFinancialAlerts] = useState<FinancialAlert[]>([]);
  const [turnover, setTurnover] = useState<InventoryTurnoverResult | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, dayRes, hourRes, weekdayRes, ordersRes, topRes, lowRes, actRes, alertRes, turnoverRes] = await Promise.all([
        getDashboardKpis(),
        getRevenueByDay(),
        getRevenueByHour(),
        getRevenueByWeekday(),
        getOrdersByWeekday(),
        getTopProducts(10),
        getLowStockProducts(5),
        getRecentActivities(8),
        getFinancialAlerts().catch(() => [] as FinancialAlert[]),
        getInventoryTurnover().catch(() => null as InventoryTurnoverResult | null),
      ]);
      setKpis(kpiRes);
      setRevenueDay(dayRes);
      setRevenueHour(hourRes);
      setRevenueWeekday(weekdayRes);
      setOrders(ordersRes);
      setTopProds(topRes);
      setLowStock(lowRes);
      setActivities(actRes);
      setFinancialAlerts(alertRes);
      setTurnover(turnoverRes);
    } catch {
      // Silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const today = new Date();
  const formattedDate = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(today);

  const chartData: Record<ChartView, ChartPoint[]> = {
    day: revenueDay,
    hour: revenueHour,
    weekday: revenueWeekday,
  };

  const kpiCards = kpis
    ? [
        {
          label: "Doanh thu",
          value: kpis.todayRevenue,
          icon: TrendingUp,
          color: "text-green-600",
          bg: "bg-green-100",
          ...calcChange(kpis.todayRevenue, kpis.yesterdayRevenue),
          changeLabel: "vs hôm qua",
          isCurrency: true,
        },
        {
          label: "Đơn hàng",
          value: kpis.todayOrders,
          icon: ShoppingCart,
          color: "text-blue-600",
          bg: "bg-blue-100",
          ...calcDiff(kpis.todayOrders, kpis.yesterdayOrders),
          changeLabel: "vs hôm qua",
          isCurrency: false,
        },
        {
          label: "Khách hàng mới",
          value: kpis.newCustomers,
          icon: Users,
          color: "text-purple-600",
          bg: "bg-purple-100",
          ...calcDiff(kpis.newCustomers, kpis.yesterdayNewCustomers),
          changeLabel: "vs hôm qua",
          isCurrency: false,
        },
        {
          label: "Lợi nhuận",
          value: kpis.todayProfit,
          icon: DollarSign,
          color: "text-orange-600",
          bg: "bg-orange-100",
          ...calcChange(kpis.todayProfit, kpis.yesterdayProfit),
          changeLabel: "vs hôm qua",
          isCurrency: true,
        },
      ]
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Date display */}
      <div className="flex items-center gap-2">
        <Clock className="size-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground capitalize">{formattedDate}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <CardContent className="pt-0">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="text-xl lg:text-2xl font-bold">
                      {kpi.isCurrency ? formatCurrency(kpi.value) : kpi.value.toLocaleString("vi-VN")}
                    </p>
                    <p className={cn("text-[11px]", kpi.positive ? "text-green-600" : "text-red-500")}>
                      {kpi.text}{" "}
                      <span className="text-muted-foreground">{kpi.changeLabel}</span>
                    </p>
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

      {/* Quick Actions + Inventory Turnover */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Quick Actions */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Thao tác nhanh</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Link href="/pos">
                <Button size="sm" className="gap-1.5 h-8">
                  <ShoppingCart className="size-3.5" /> Bán hàng POS
                </Button>
              </Link>
              <Link href="/don-hang/dat-hang">
                <Button size="sm" variant="outline" className="gap-1.5 h-8">
                  <Plus className="size-3.5" /> Tạo đơn hàng
                </Button>
              </Link>
              <Link href="/hang-hoa/nhap-hang">
                <Button size="sm" variant="outline" className="gap-1.5 h-8">
                  <Boxes className="size-3.5" /> Nhập hàng
                </Button>
              </Link>
              <Link href="/hang-hoa/chuyen-kho">
                <Button size="sm" variant="outline" className="gap-1.5 h-8">
                  <ArrowLeftRight className="size-3.5" /> Chuyển kho
                </Button>
              </Link>
              <Link href="/tai-chinh/so-quy">
                <Button size="sm" variant="outline" className="gap-1.5 h-8">
                  <Receipt className="size-3.5" /> Sổ quỹ
                </Button>
              </Link>
              <Link href="/phan-tich/bao-cao-tai-chinh">
                <Button size="sm" variant="outline" className="gap-1.5 h-8">
                  <BarChart3 className="size-3.5" /> Báo cáo P&L
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Inventory Turnover Widget */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Package className="size-4 text-indigo-500" />
              Vòng quay kho
            </CardTitle>
          </CardHeader>
          <CardContent>
            {turnover ? (
              <div className="space-y-2">
                <p className="text-3xl font-bold text-indigo-600">
                  {turnover.turnoverRatio.toFixed(1)}x
                </p>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>COGS</span>
                    <span className="font-medium">{formatCurrency(turnover.totalCogsPeriod)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Giá trị kho TB</span>
                    <span className="font-medium">{formatCurrency(turnover.avgInventoryValue)}</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground pt-1 border-t">
                  {turnover.turnoverRatio >= 4
                    ? "Tốt — hàng xoay nhanh"
                    : turnover.turnoverRatio >= 2
                      ? "Trung bình — cần cải thiện"
                      : "Chậm — cần xem lại tồn kho"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">Chưa có dữ liệu</p>
            )}
          </CardContent>
        </Card>
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
                <AreaChart data={chartData[chartView]} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
                <BarChart data={orders} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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

      {/* Financial Alerts Widget */}
      {financialAlerts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-amber-500" />
                Cảnh báo tài chính
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                  {financialAlerts.length}
                </Badge>
              </CardTitle>
              <Link
                href="/phan-tich/canh-bao"
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                Xem tất cả <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {financialAlerts.slice(0, 4).map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    "flex items-center gap-3 p-2.5 rounded-lg border",
                    alert.severity === "critical"
                      ? "bg-red-50 border-red-200"
                      : "bg-amber-50 border-amber-200"
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "size-4 shrink-0",
                      alert.severity === "critical"
                        ? "text-red-600"
                        : "text-amber-600"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{alert.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {alert.description}
                    </p>
                  </div>
                  {alert.link && (
                    <Link href={alert.link}>
                      <ArrowRight className="size-3.5 text-muted-foreground hover:text-primary shrink-0" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
            {topProds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Chưa có dữ liệu bán hàng</p>
            ) : (
              <div className="space-y-2">
                {topProds.slice(0, 7).map((product, index) => (
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
            )}
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
                {lowStock.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Không có hàng sắp hết</p>
            ) : (
              <div className="space-y-2.5">
                {lowStock.map((product) => (
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
            )}
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
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Chưa có hoạt động nào</p>
            ) : (
              <div className="space-y-3">
                {activities.slice(0, 6).map((activity) => {
                  const Icon = ENTITY_ICONS[activity.entityType] ?? FileText;
                  return (
                    <div key={activity.id} className="flex items-start gap-2.5">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Icon className="size-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs">
                          <span className="font-medium">{activity.userName}</span>{" "}
                          <span className="text-muted-foreground">{activity.action}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground">{activity.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
