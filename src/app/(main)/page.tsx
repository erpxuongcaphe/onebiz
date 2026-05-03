"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrency,
  formatChartCurrency,
} from "@/lib/format";
import { cn } from "@/lib/utils";

// PERF F4: Lazy load Recharts (~150KB gz + d3 deps) — chỉ load khi user
// thực sự reach dashboard charts, không bundle vào initial JS.
const DashboardCharts = dynamic(() => import("./_dashboard-charts"), {
  loading: () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-72 rounded-xl border bg-card animate-pulse"
        />
      ))}
    </div>
  ),
  ssr: false,
});
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
import { useBranchFilter } from "@/lib/contexts";
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
import { Icon } from "@/components/ui/icon";

type ChartView = "day" | "hour" | "weekday";

// Map activity entity → Material Symbols icon name (Stitch).
const ENTITY_ICONS: Record<string, string> = {
  invoice: "receipt_long",
  product: "inventory_2",
  customer: "group",
  purchase_order: "inventory_2",
  cash_transaction: "payments",
};

// Custom tooltips — Stitch style: rounded-xl + ambient-shadow, surface-container-lowest bg.
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
  // PERF F9+F12: isReady = AuthContext load xong → safe để fire data fetch
  // mà không lo activeBranchId đổi từ undefined → branch_id sau đó (gây
  // double-fire mỗi service).
  const { activeBranchId, isReady } = useBranchFilter();
  const [chartView, setChartView] = useState<ChartView>("day");
  // Progressive loading: KPI skeleton trước, charts + secondary widgets sau.
  // Trước đây single `loading` flag block toàn bộ dashboard 2-4s → user thấy spinner
  // quay vòng. Giờ KPI xuất hiện <500ms, phần còn lại fill dần.
  const [kpiLoading, setKpiLoading] = useState(true);
  const [chartsLoading, setChartsLoading] = useState(true);

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

  // Phase 1 — KPI + turnover (critical path, hiển thị đầu tiên ~300-500ms)
  const fetchPhase1 = useCallback(async () => {
    setKpiLoading(true);
    try {
      const [kpiRes, turnoverRes] = await Promise.all([
        getDashboardKpis(activeBranchId),
        getInventoryTurnover().catch(() => null as InventoryTurnoverResult | null),
      ]);
      setKpis(kpiRes);
      setTurnover(turnoverRes);
    } catch {
      // Silently fail — show empty state
    } finally {
      setKpiLoading(false);
    }
  }, [activeBranchId]);

  // Phase 2 — charts + secondary widgets (không block KPI hiển thị)
  const fetchPhase2 = useCallback(async () => {
    setChartsLoading(true);
    try {
      const [dayRes, hourRes, weekdayRes, ordersRes, topRes, lowRes, actRes, alertRes] =
        await Promise.all([
          getRevenueByDay(7, activeBranchId),
          getRevenueByHour(activeBranchId),
          getRevenueByWeekday(activeBranchId),
          getOrdersByWeekday(activeBranchId),
          getTopProducts(10, activeBranchId),
          getLowStockProducts(5),
          getRecentActivities(8),
          getFinancialAlerts().catch(() => [] as FinancialAlert[]),
        ]);
      setRevenueDay(dayRes);
      setRevenueHour(hourRes);
      setRevenueWeekday(weekdayRes);
      setOrders(ordersRes);
      setTopProds(topRes);
      setLowStock(lowRes);
      setActivities(actRes);
      setFinancialAlerts(alertRes);
    } catch {
      // Silently fail — show empty state
    } finally {
      setChartsLoading(false);
    }
  }, [activeBranchId]);

  // PERF F9+F12: chờ isReady (AuthContext xong) rồi mới fetch.
  useEffect(() => {
    if (!isReady) return;
    fetchPhase1();
    fetchPhase2();
  }, [fetchPhase1, fetchPhase2, isReady]);

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

  // KPI tiles — `icon` là Material Symbols name (string). `bg`/`color` giữ semantic colors
  // (success/warning/purple/orange) ngoài primary-fixed để phân loại trực quan nhanh.
  // Stitch KPI card spec: icon `text-primary bg-primary-fixed p-2 rounded-lg`, uppercase label,
  // font-headline bold number. All cards dùng cùng primary palette (không rainbow) để brand-consistent.
  const kpiCards = kpis
    ? [
        {
          label: "Doanh thu",
          value: kpis.todayRevenue,
          icon: "trending_up",
          ...calcChange(kpis.todayRevenue, kpis.yesterdayRevenue),
          changeLabel: "vs hôm qua",
          isCurrency: true,
        },
        {
          label: "Đơn hàng",
          value: kpis.todayOrders,
          icon: "shopping_cart",
          ...calcDiff(kpis.todayOrders, kpis.yesterdayOrders),
          changeLabel: "vs hôm qua",
          isCurrency: false,
        },
        {
          label: "Khách hàng mới",
          value: kpis.newCustomers,
          icon: "group",
          ...calcDiff(kpis.newCustomers, kpis.yesterdayNewCustomers),
          changeLabel: "vs hôm qua",
          isCurrency: false,
        },
        {
          label: "Lợi nhuận",
          value: kpis.todayProfit,
          icon: "attach_money",
          ...calcChange(kpis.todayProfit, kpis.yesterdayProfit),
          changeLabel: "vs hôm qua",
          isCurrency: true,
        },
      ]
    : [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ── Hero: Date + Quick Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="schedule" className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground capitalize">{formattedDate}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/pos">
            <Button size="sm" className="gap-1.5 h-9 shadow-sm">
              <Icon name="shopping_cart" className="size-3.5" /> POS Retail
            </Button>
          </Link>
          <Link href="/pos/fnb">
            <Button size="sm" className="gap-1.5 h-9 shadow-sm bg-status-warning hover:bg-status-warning text-white">
              <Icon name="local_cafe" className="size-3.5" /> POS F&B
            </Button>
          </Link>
          <div className="hidden sm:block h-5 w-px bg-border" />
          <Link href="/don-hang/dat-hang">
            <Button size="sm" variant="outline" className="gap-1.5 h-9">
              <Icon name="add" className="size-3.5" /> Đơn hàng
            </Button>
          </Link>
          <Link href="/hang-hoa/nhap-hang">
            <Button size="sm" variant="outline" className="gap-1.5 h-9">
              <Icon name="inventory" className="size-3.5" /> Nhập hàng
            </Button>
          </Link>
          <Link href="/hang-hoa/chuyen-kho">
            <Button size="sm" variant="outline" className="gap-1.5 h-9">
              <Icon name="swap_horiz" className="size-3.5" /> Chuyển kho
            </Button>
          </Link>
          <Link href="/tai-chinh/so-quy">
            <Button size="sm" variant="outline" className="gap-1.5 h-9">
              <Icon name="receipt" className="size-3.5" /> Sổ quỹ
            </Button>
          </Link>
          <Link href="/phan-tich/bao-cao-tai-chinh">
            <Button size="sm" variant="outline" className="gap-1.5 h-9">
              <Icon name="bar_chart" className="size-3.5" /> P&L
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards + Inventory Turnover — Stitch spec: rounded-xl, padding rộng,
          icon bg-primary-fixed text-primary, uppercase label widest tracking,
          headline font + bold number. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Skeleton khi kpis chưa load để UI không nhảy — 4 card + 1 turnover bên dưới. */}
        {kpiLoading && !kpis &&
          Array.from({ length: 4 }).map((_, i) => (
            <Card
              key={`skel-${i}`}
              className="rounded-xl border-0 ambient-shadow bg-surface-container-lowest"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <span className="h-3 w-20 rounded bg-muted/60 animate-pulse" />
                  <div className="size-9 rounded-lg bg-muted/60 animate-pulse" />
                </div>
                <div className="h-8 w-28 rounded bg-muted/60 animate-pulse" />
                <div className="mt-2 h-3 w-24 rounded bg-muted/50 animate-pulse" />
              </CardContent>
            </Card>
          ))}
        {kpiCards.map((kpi) => (
          <Card
            key={kpi.label}
            className="rounded-xl border-0 ambient-shadow bg-surface-container-lowest"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {kpi.label}
                </span>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed">
                  <Icon name={kpi.icon} size={18} className="text-primary" />
                </div>
              </div>
              <p className="font-heading text-2xl lg:text-3xl font-extrabold tracking-tight text-foreground leading-tight">
                {kpi.isCurrency ? formatCurrency(kpi.value) : kpi.value.toLocaleString("vi-VN")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className={cn("font-semibold", kpi.positive ? "text-status-success" : "text-status-error")}>
                  {kpi.text}
                </span>{" "}
                {kpi.changeLabel}
              </p>
            </CardContent>
          </Card>
        ))}

        {/* Inventory Turnover — inline as 5th card */}
        <Card className="col-span-2 lg:col-span-1 rounded-xl border-0 ambient-shadow bg-surface-container-lowest">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Vòng quay kho
              </span>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed">
                <Icon name="autorenew" size={18} className="text-primary" />
              </div>
            </div>
            <p className="font-heading text-2xl lg:text-3xl font-extrabold tracking-tight text-foreground leading-tight">
              {turnover ? `${turnover.turnoverRatio.toFixed(1)}x` : "—"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {turnover
                ? `COGS ${formatChartCurrency(turnover.totalCogsPeriod)}`
                : "Chưa có dữ liệu"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row — lazy loaded để giảm initial bundle (~150KB recharts). */}
      <DashboardCharts
        chartData={chartData}
        chartView={chartView}
        setChartView={setChartView}
        orders={orders}
      />

      {/* Financial Alerts Widget */}
      {financialAlerts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Icon name="warning" className="size-4 text-status-warning" />
                Cảnh báo tài chính
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                  {financialAlerts.length}
                </Badge>
              </CardTitle>
              <Link
                href="/phan-tich/canh-bao"
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                Xem tất cả <Icon name="arrow_forward" className="size-3" />
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
                      ? "bg-status-error/10 border-status-error/25"
                      : "bg-status-warning/10 border-status-warning/25"
                  )}
                >
                  <Icon name="warning"
                    className={cn(
                                                                      "size-4 shrink-0",
                                                                      alert.severity === "critical"
                                                                        ? "text-status-error"
                                                                        : "text-status-warning"
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
                      <Icon name="arrow_forward" className="size-3.5 text-muted-foreground hover:text-primary shrink-0" />
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
                Xem thêm <Icon name="arrow_forward" className="size-3" />
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
                      index < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
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
                <Icon name="warning" className="size-4 text-status-warning" />
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
                  Quản lý tồn kho <Icon name="arrow_forward" className="size-3" />
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
                <Icon name="analytics" size={12} /> Phân tích
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Chưa có hoạt động nào</p>
            ) : (
              <div className="space-y-3">
                {activities.slice(0, 6).map((activity) => {
                  const iconName = ENTITY_ICONS[activity.entityType] ?? "description";
                  return (
                    <div key={activity.id} className="flex items-start gap-2.5">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-container">
                        <Icon name={iconName} size={14} className="text-muted-foreground" />
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
