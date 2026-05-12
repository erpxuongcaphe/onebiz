"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  formatCurrency,
  formatNumber,
  formatShortDate,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import {
  getDashboardKpis,
  getFinancialAlerts,
  getManagerLowStockProducts,
  getOrdersByWeekday,
  getRecentActivities,
  getRevenueByDay,
  getRevenueByHour,
  getStockoutForecast,
  getTopProducts,
} from "@/lib/services";
import type {
  ChartPoint,
  DashboardKpis,
  OrderChartPoint,
  RecentActivity,
  TopProduct,
} from "@/lib/services/supabase/dashboard";
import type {
  FinancialAlert,
} from "@/lib/services/supabase/reports";
import type { ManagerLowStockProduct, StockForecastRow } from "@/lib/services/supabase/stock-forecast";

type ScreenId = "overview" | "inventory" | "activity" | "analytics";

interface ManagerData {
  kpis: DashboardKpis | null;
  revenueByDay: ChartPoint[];
  revenueByHour: ChartPoint[];
  ordersByWeekday: OrderChartPoint[];
  topProducts: TopProduct[];
  lowStock: ManagerLowStockProduct[];
  stockForecast: StockForecastRow[];
  activities: RecentActivity[];
  alerts: FinancialAlert[];
}

const EMPTY_DATA: ManagerData = {
  kpis: null,
  revenueByDay: [],
  revenueByHour: [],
  ordersByWeekday: [],
  topProducts: [],
  lowStock: [],
  stockForecast: [],
  activities: [],
  alerts: [],
};

const SCREENS: Array<{
  id: ScreenId;
  label: string;
  shortLabel: string;
  icon: string;
}> = [
  { id: "overview", label: "Tổng quan", shortLabel: "Tổng quan", icon: "dashboard" },
  { id: "inventory", label: "Tồn kho", shortLabel: "Kho", icon: "warehouse" },
  { id: "activity", label: "Hoạt động", shortLabel: "Hoạt động", icon: "receipt_long" },
  { id: "analytics", label: "Phân tích", shortLabel: "Báo cáo", icon: "monitoring" },
];

function calcChange(current: number, previous: number) {
  if (previous === 0) {
    return { text: current > 0 ? "+100%" : "0%", positive: current >= 0 };
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(1)}%`, positive: pct >= 0 };
}

function calcDiff(current: number, previous: number) {
  const diff = current - previous;
  const sign = diff >= 0 ? "+" : "";
  return { text: `${sign}${formatNumber(diff)}`, positive: diff >= 0 };
}

export default function ManagerPwaPage() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>("overview");
  const [data, setData] = useState<ManagerData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { activeBranchId, currentBranch, isReady } = useBranchFilter();
  const { user } = useAuth();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        kpis,
        revenueByDay,
        revenueByHour,
        ordersByWeekday,
        topProducts,
        lowStock,
        stockForecast,
        activities,
        alerts,
      ] = await Promise.all([
        getDashboardKpis(activeBranchId),
        getRevenueByDay(7, activeBranchId),
        getRevenueByHour(activeBranchId),
        getOrdersByWeekday(activeBranchId),
        getTopProducts(8, activeBranchId),
        getManagerLowStockProducts({ branchId: activeBranchId, limit: 8, productType: "sku" }),
        getStockoutForecast({ branchId: activeBranchId, days: 30, limit: 8, productType: "sku" }).catch(() => [] as StockForecastRow[]),
        getRecentActivities(10),
        getFinancialAlerts().catch(() => [] as FinancialAlert[]),
      ]);

      setData({
        kpis,
        revenueByDay,
        revenueByHour,
        ordersByWeekday,
        topProducts,
        lowStock,
        stockForecast,
        activities,
        alerts,
      });
    } catch (err) {
      console.error("[manager-pwa] load failed", err);
      setError("Chưa tải được dữ liệu quản lý. Anh thử làm mới lại màn hình.");
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    if (!isReady) return;
    loadData();
  }, [isReady, loadData]);

  const firstName = user?.fullName?.split(" ").pop() ?? "admin";
  const today = formatShortDate(new Date());
  const branchName = currentBranch?.name ?? "Tất cả chi nhánh";

  return (
    <main className="min-h-dvh overflow-x-hidden bg-surface-container-low text-foreground">
      <ManagerTopBar
        firstName={firstName}
        branchName={branchName}
        date={today}
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        onRefresh={loadData}
        loading={loading}
      />

      <section className="mx-auto w-full max-w-[1160px] px-2 pb-16 pt-2 sm:px-3 md:px-4 md:pb-6">
        {error && (
          <div className="mb-3 rounded-lg border border-status-error/25 bg-status-error/10 p-3 text-sm font-medium text-status-error">
            {error}
          </div>
        )}

        {loading && !data.kpis ? (
          <ManagerSkeleton />
        ) : (
          <>
            {activeScreen === "overview" && <OverviewScreen data={data} />}
            {activeScreen === "inventory" && <InventoryScreen data={data} />}
            {activeScreen === "activity" && <ActivityScreen data={data} />}
            {activeScreen === "analytics" && <AnalyticsScreen data={data} />}
          </>
        )}
      </section>

      <MobileNav activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
    </main>
  );
}

function ManagerTopBar({
  firstName,
  branchName,
  date,
  activeScreen,
  setActiveScreen,
  onRefresh,
  loading,
}: {
  firstName: string;
  branchName: string;
  date: string;
  activeScreen: ScreenId;
  setActiveScreen: (screen: ScreenId) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-2 px-2.5 py-2 sm:px-3 md:px-4">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-extrabold text-primary-foreground shadow-sm">
              O.
            </div>
            <div className="min-w-0">
              <div className="truncate font-heading text-base font-bold leading-tight sm:text-lg">
                Manager
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {date} · {branchName}
              </div>
            </div>
          </div>

          <nav className="hidden min-w-0 flex-1 justify-center gap-1.5 overflow-x-auto px-2 md:flex" aria-label="Manager sections">
            {SCREENS.map((screen) => (
              <button
                key={screen.id}
                type="button"
                onClick={() => setActiveScreen(screen.id)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold transition-colors",
                  activeScreen === screen.id
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-white text-muted-foreground hover:bg-primary-fixed hover:text-primary",
                )}
              >
                <Icon name={screen.icon} size={16} fill={activeScreen === screen.id} />
                {screen.label}
              </button>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="hidden h-7 rounded-lg bg-white sm:inline-flex">
              Dữ liệu thật
            </Badge>
            {/* CEO 12/05: shortcut cấp OTP duyệt từ xa — manager truy cập nhanh
                khi cashier gọi điện xin duyệt action nhạy cảm. */}
            <Link href="/manager/otp" aria-label="Cấp OTP duyệt từ xa">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 border-status-warning/40 bg-status-warning/5 text-status-warning hover:bg-status-warning/10"
              >
                <Icon name="pin" size={16} className="mr-1" />
                <span className="hidden sm:inline">Cấp OTP</span>
              </Button>
            </Link>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onRefresh}
              aria-label="Làm mới dữ liệu"
            >
              <Icon
                name="refresh"
                size={18}
                className={cn(loading && "animate-spin")}
              />
            </Button>
            <Link href="/">
              <Button variant="outline" size="icon" aria-label="Mở web đầy đủ">
                <Icon name="open_in_new" size={18} />
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 md:hidden">
          <div className="min-w-0">
            <h1 className="truncate font-heading text-lg font-bold leading-tight sm:text-xl">
              Chào {firstName}
            </h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
              Theo dõi vận hành trong vài giây, tối ưu cho điện thoại và tablet.
            </p>
          </div>
        </div>

      </div>
    </header>
  );
}

function OverviewScreen({ data }: { data: ManagerData }) {
  const kpis = data.kpis;
  const collectedChange = calcChange(
    kpis?.todayCollected ?? 0,
    kpis?.yesterdayCollected ?? 0,
  );
  const orderChange = calcDiff(kpis?.todayOrders ?? 0, kpis?.yesterdayOrders ?? 0);
  const profitChange = calcChange(kpis?.todayProfit ?? 0, kpis?.yesterdayProfit ?? 0);

  return (
    <div className="space-y-2.5 md:space-y-3">
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <CollectionCard kpis={kpis} change={collectedChange} />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
          <KpiTile
            label="Đơn hàng"
            value={formatNumber(kpis?.todayOrders ?? 0)}
            delta={orderChange.text}
            positive={orderChange.positive}
            icon="shopping_cart"
          />
          <KpiTile
            label="Lợi nhuận"
            value={formatCurrency(kpis?.todayProfit ?? 0)}
            delta={profitChange.text}
            positive={profitChange.positive}
            icon="payments"
          />
          <KpiTile
            label="Khách mới"
            value={formatNumber(kpis?.newCustomers ?? 0)}
            delta="Hôm nay"
            positive
            icon="group"
          />
          <KpiTile
            label="Sắp hết"
            value={formatNumber(data.lowStock.length)}
            delta="Cần xử lý"
            positive={data.lowStock.length === 0}
            icon="warning"
            tone="warning"
          />
        </div>
      </div>

      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
        <BarChartCard
          title="Doanh thu theo giờ"
          points={data.revenueByHour}
          emptyText="Chưa có doanh thu trong ngày"
        />
        <RecentActivityCard activities={data.activities} />
      </div>
    </div>
  );
}

function InventoryScreen({ data }: { data: ManagerData }) {
  return (
    <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold">Cảnh báo tồn kho</h2>
            <p className="text-sm text-muted-foreground">
              Theo chi nhánh đang chọn, ưu tiên hàng dưới định mức.
            </p>
          </div>
          <Badge variant={data.lowStock.length ? "destructive" : "secondary"}>
            {data.lowStock.length}
          </Badge>
        </div>

        <div className="space-y-2">
          {data.lowStock.length === 0 ? (
            <EmptyState icon="task_alt" title="Kho đang ổn" text="Chưa có mặt hàng dưới định mức cảnh báo." />
          ) : (
            data.lowStock.map((item) => (
              <div
                key={`${item.branchId}:${item.productId}`}
                className="grid gap-2.5 rounded-lg border border-border bg-surface-container-lowest p-2.5 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold">{item.productName}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">
                    {item.productCode || "Chưa có mã"} · {item.branchName}
                  </div>
                  <div className="mt-1 text-xs font-medium text-status-warning">
                    Thiếu {formatNumber(item.shortage)} {item.unit ?? ""} so với định mức
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <div className="text-right">
                    <div className="font-heading text-xl font-extrabold text-status-warning">
                      {formatNumber(item.stock)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Min {formatNumber(item.minStock)}
                    </div>
                  </div>
                  <Link href="/hang-hoa/dat-hang-nhap">
                    <Button size="sm" variant="outline">
                      Nhập
                    </Button>
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <StockForecastCard rows={data.stockForecast} />
    </div>
  );
}

function StockForecastCard({ rows }: { rows: StockForecastRow[] }) {
  const urgentCount = rows.filter((row) => row.urgency === "critical" || row.urgency === "warning").length;

  return (
    <section className="min-w-0 rounded-lg border border-border bg-white p-2.5 shadow-sm md:p-3.5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold">Dự báo hết hàng</h2>
          <p className="text-sm text-muted-foreground">
            Dựa trên tồn hiện tại và lịch sử bán/xuất 30 ngày.
          </p>
        </div>
        <Badge variant={urgentCount ? "destructive" : "secondary"}>{urgentCount}</Badge>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="show_chart"
          title="Chưa đủ dữ liệu dự báo"
          text="Khi có lịch sử bán/xuất, hệ thống sẽ ước tính ngày cần nhập thêm."
        />
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 5).map((row) => (
            <div
              key={row.productId}
              className="rounded-lg border border-border bg-surface-container-lowest p-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{row.productName}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {row.productCode || "Chưa có mã"} · Tồn {formatNumber(row.stock)} {row.unit ?? ""}
                  </div>
                </div>
                <UrgencyBadge urgency={row.urgency} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-white px-2 py-1.5">
                  <div className="text-muted-foreground">Dự kiến còn</div>
                  <div className="font-heading text-base font-bold">
                    {row.daysUntilStockout === null ? "N/A" : `${formatNumber(row.daysUntilStockout)} ngày`}
                  </div>
                </div>
                <div className="rounded-md bg-white px-2 py-1.5">
                  <div className="text-muted-foreground">Xuất TB/ngày</div>
                  <div className="font-heading text-base font-bold">
                    {formatNumber(row.avgDailyOut)}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs font-medium text-muted-foreground">
                {row.suggestion}
                {row.forecastDate ? ` · ${formatShortDate(row.forecastDate)}` : ""}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Link href="/hang-hoa/ton-kho">
              <Button variant="outline" size="sm" className="w-full">
                Tồn kho
              </Button>
            </Link>
            <Link href="/hang-hoa/dat-hang-nhap">
              <Button size="sm" className="w-full">
                Đặt nhập
              </Button>
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function UrgencyBadge({ urgency }: { urgency: StockForecastRow["urgency"] }) {
  const config = {
    critical: { label: "Gấp", className: "bg-status-error/10 text-status-error" },
    warning: { label: "Sớm", className: "bg-status-warning/10 text-status-warning" },
    watch: { label: "Theo dõi", className: "bg-primary-fixed text-primary" },
    stable: { label: "Ổn", className: "bg-muted text-muted-foreground" },
  }[urgency];

  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", config.className)}>
      {config.label}
    </span>
  );
}

function ActivityScreen({ data }: { data: ManagerData }) {
  return (
    <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      <RecentActivityCard activities={data.activities} large />
      <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold">Cảnh báo tài chính</h2>
          <Badge variant={data.alerts.length ? "destructive" : "secondary"}>
            {data.alerts.length}
          </Badge>
        </div>
        <div className="space-y-2">
          {data.alerts.length === 0 ? (
            <EmptyState icon="verified" title="Chưa có cảnh báo" text="Các chỉ số tài chính đang trong ngưỡng theo dõi." />
          ) : (
            data.alerts.slice(0, 6).map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "rounded-lg border p-3",
                  alert.severity === "critical"
                    ? "border-status-error/25 bg-status-error/10"
                    : "border-status-warning/25 bg-status-warning/10",
                )}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    name="warning"
                    size={18}
                    className={
                      alert.severity === "critical"
                        ? "text-status-error"
                        : "text-status-warning"
                    }
                  />
                  <div className="min-w-0">
                    <div className="font-semibold">{alert.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {alert.description}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function AnalyticsScreen({ data }: { data: ManagerData }) {
  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
        <BarChartCard
          title="Doanh thu 7 ngày"
          points={data.revenueByDay}
          emptyText="Chưa có doanh thu 7 ngày gần nhất"
        />
        <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-4">
          <h2 className="mb-3 font-heading text-lg font-bold">Top sản phẩm</h2>
          <div className="space-y-2">
            {data.topProducts.length === 0 ? (
              <EmptyState icon="inventory_2" title="Chưa có dữ liệu bán hàng" text="Top sản phẩm sẽ hiện khi có hóa đơn hoàn thành." />
            ) : (
              data.topProducts.slice(0, 8).map((product, index) => (
                <div key={product.name} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-sm font-bold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      SL {formatNumber(product.qty)}
                    </div>
                  </div>
                  <div className="text-right text-sm font-bold">
                    {formatCurrency(product.revenue)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-4">
        <h2 className="mb-3 font-heading text-lg font-bold">Đơn hàng theo trạng thái</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.ordersByWeekday.map((row) => (
            <div key={row.day} className="rounded-lg border border-border bg-surface-container-lowest p-3">
              <div className="text-sm font-semibold">{row.day}</div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-status-success">Hoàn thành</span>
                <span className="font-bold">{formatNumber(row.completed)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-status-error">Đã hủy</span>
                <span className="font-bold">{formatNumber(row.cancelled)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CollectionCard({
  kpis,
  change,
}: {
  kpis: DashboardKpis | null;
  change: { text: string; positive: boolean };
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-3.5">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Thực thu
          </div>
          <div className="mt-1.5 font-heading text-3xl font-extrabold leading-none text-foreground sm:text-4xl">
            {formatCurrency(kpis?.todayCollected ?? 0)}
          </div>
          <div className="mt-1.5 text-sm text-muted-foreground">
            <span className={cn("font-semibold", change.positive ? "text-status-success" : "text-status-error")}>
              {change.text}
            </span>{" "}
            vs hôm qua
          </div>
        </div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:size-10">
          <Icon name="payments" size={22} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CollectionMini label="Tiền mặt" value={kpis?.todayCash ?? 0} />
        <CollectionMini label="Chuyển khoản" value={kpis?.todayTransfer ?? 0} />
        <CollectionMini label="Thẻ" value={kpis?.todayCard ?? 0} />
        <CollectionMini label="Giảm trừ" value={kpis?.todayDiscounts ?? 0} muted />
      </div>
    </section>
  );
}

function CollectionMini({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className={cn("rounded-lg p-2.5", muted ? "bg-muted/70" : "bg-primary-fixed")}>
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate font-heading text-base font-bold", muted ? "text-foreground" : "text-primary")}>
        {formatCurrency(value)}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  positive,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  icon: string;
  tone?: "primary" | "warning";
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-white p-2.5 shadow-sm md:p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs font-semibold uppercase text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            tone === "warning"
              ? "bg-status-warning/10 text-status-warning"
              : "bg-primary-fixed text-primary",
          )}
        >
          <Icon name={icon} size={17} />
        </div>
      </div>
      <div className="mt-2 truncate font-heading text-xl font-extrabold sm:text-2xl">
        {value}
      </div>
      <div className={cn("mt-1 text-xs font-semibold", positive ? "text-status-success" : "text-status-error")}>
        {delta}
      </div>
    </section>
  );
}

function BarChartCard({
  title,
  points,
  emptyText,
  unit = "VND",
}: {
  title: string;
  points: ChartPoint[];
  emptyText: string;
  /** Đơn vị hiển thị ngang title (VND / Đơn / Khách...). Default "VND" vì 99% chart Manager là doanh thu. */
  unit?: string;
}) {
  const max = Math.max(...points.map((point) => point.value), 0);

  return (
    <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        <Badge variant="outline">{unit}</Badge>
      </div>

      {max <= 0 ? (
        <EmptyState icon="bar_chart" title={emptyText} text="Biểu đồ sẽ tự cập nhật khi có dữ liệu mới." />
      ) : (
        <>
          <div className="flex h-36 items-end gap-1.5 rounded-lg border border-dashed border-border bg-surface-container-lowest px-2 pb-2 pt-4 sm:h-44 md:h-52 md:gap-2 md:px-3 md:pb-3">
            {points.map((point) => (
              <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div
                  className="w-full rounded-t-md bg-primary"
                  style={{ height: `${Math.max(8, (point.value / max) * 100)}%` }}
                  title={`${point.label}: ${formatCurrency(point.value)}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))` }}>
            {points.map((point) => (
              <span key={point.label} className="truncate text-center">
                {point.label}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RecentActivityCard({
  activities,
  large,
}: {
  activities: RecentActivity[];
  large?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-white p-3 shadow-sm md:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold">Hoạt động gần đây</h2>
        <Link href="/he-thong/audit" className="text-sm font-semibold text-primary">
          Xem tất cả
        </Link>
      </div>
      <div className={cn("space-y-2", large && "md:space-y-3")}>
        {activities.length === 0 ? (
          <EmptyState icon="history" title="Chưa có hoạt động" text="Các đơn, phiếu và thao tác hệ thống sẽ hiện tại đây." />
        ) : (
          activities.slice(0, large ? 10 : 5).map((activity) => (
            <div key={activity.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                <Icon name="description" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  <span className="font-semibold">{activity.userName}</span>{" "}
                  <span className="text-muted-foreground">{activity.action}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{activity.time}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-container-lowest p-4 text-center md:min-h-36">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
        <Icon name={icon} size={20} />
      </div>
      <div className="mt-2 font-semibold">{title}</div>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ManagerSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <div className="h-40 animate-pulse rounded-lg bg-white md:h-44" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg bg-white md:h-28" />
          ))}
        </div>
      </div>
      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
        <div className="h-56 animate-pulse rounded-lg bg-white" />
        <div className="h-56 animate-pulse rounded-lg bg-white" />
      </div>
    </div>
  );
}

function MobileNav({
  activeScreen,
  setActiveScreen,
}: {
  activeScreen: ScreenId;
  setActiveScreen: (screen: ScreenId) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] md:hidden">
      {SCREENS.map((screen) => (
        <button
          key={screen.id}
          type="button"
          onClick={() => setActiveScreen(screen.id)}
          className={cn(
            "flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold",
            activeScreen === screen.id ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Icon name={screen.icon} size={19} fill={activeScreen === screen.id} />
          <span className="max-w-full truncate px-1">{screen.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}
