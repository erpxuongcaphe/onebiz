"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { useReceivingVietnamDay } from "@/lib/hooks/use-receiving-view-memory";
import { canViewSalesDashboard, salesRange, type SalesDashboard, type SalesGrain } from "@/lib/dashboard-sales";
import { getSalesDashboard } from "@/lib/services/supabase/dashboard-sales";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { UnpaidBills } from "./_unpaid-bills";

const SalesCharts = dynamic(() => import("./_sales-overview-charts"), {
  ssr: false,
  loading: () => <div role="status" className="h-60 animate-pulse bg-muted" aria-label="Đang tải biểu đồ" />,
});
const GRAINS: { value: SalesGrain; label: string }[] = [
  { value: "hour", label: "Giờ" }, { value: "day", label: "Ngày" },
  { value: "month", label: "Tháng" }, { value: "year", label: "Năm" },
];
const METHODS: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Thẻ", ewallet: "Ví điện tử", unknown: "Chưa phân loại" };
const WORK = [
  { permission: "pos_fnb.checkout", href: "/pos/fnb", icon: "point_of_sale", label: "Bán hàng F&B" },
  { permission: "pos_retail.checkout", href: "/pos", icon: "shopping_bag", label: "Bán hàng Retail" },
  { permission: "inventory.view", href: "/hang-hoa/ton-kho", icon: "inventory_2", label: "Tồn kho" },
  { permission: "production.view", href: "/san-xuat", icon: "factory", label: "Sản xuất" },
  { permission: "ops.view", href: "/hub", icon: "task_alt", label: "Công việc" },
];

function useSalesQuery(scope: string, branchId: string | undefined, from: string, to: string, grain: SalesGrain, enabled: boolean) {
  const key = `${scope}:${branchId ?? "all"}:${from}:${to}:${grain}:${enabled}`;
  const [result, setResult] = useState<{ key: string; data: SalesDashboard; at: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await getSalesDashboard(branchId, from, to, grain);
      if (request.current !== id) return;
      setResult({ key, data, at: new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }) });
      setFailure(null);
    } catch (error) {
      if (request.current === id) setFailure({ key, message: error instanceof Error ? error.message : "Không tải được tổng quan." });
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, [branchId, enabled, from, grain, key, to]);
  useEffect(() => {
    void refresh();
    return () => { request.current += 1; };
  }, [refresh]);
  const error = enabled && failure?.key === key ? failure.message : null;
  return { data: enabled && !error && result?.key === key ? result.data : null, error, at: !error && result?.key === key ? result.at : null, loading: enabled && loading, refresh };
}

export default function OperationalSalesOverview() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { tenant, user, branches, hasPermission } = useAuth();
  const branch = branches.find(item => item.id === activeBranchId);
  const canViewOpenBills = isReady && !!tenant?.id && !!user?.id && hasPermission("pos_fnb.view_orders")
    && (activeBranchId ? branch?.branchType === "store" : hasPermission("reports.view_all_branches"));
  const unpaidBills = canViewOpenBills && tenant ? <UnpaidBills key={`${tenant.id}:${user?.id}:${activeBranchId ?? "all"}`} tenantId={tenant.id} branchId={activeBranchId} /> : null;
  const allowed = activeBranchId
    ? !!branch && canViewSalesDashboard(hasPermission, branch.branchType)
    : hasPermission("reports.view_all_branches") && hasPermission("reports.dashboard")
      && (!branches.some(item => item.branchType === "store") || hasPermission("pos_fnb.view_sales_summary"));
  const today = useReceivingVietnamDay();
  const [summaryAnchor, setSummaryAnchor] = useState<string | null>(null);
  const summaryDay = summaryAnchor ?? today;
  const [anchor, setAnchor] = useState<string | null>(null);
  const [grain, setGrain] = useState<SalesGrain>("hour");
  const date = anchor ?? today;
  const range = useMemo(() => salesRange(grain, date), [grain, date]);
  const to = range.to > today ? today : range.to;
  const enabled = isReady && allowed && !!tenant?.id && !!user?.id;
  const scope = `${tenant?.id}:${user?.id}`;
  const daily = useSalesQuery(scope, activeBranchId, summaryDay, summaryDay, "hour", enabled);
  const samePeriod = grain === "hour" && range.from === summaryDay && to === summaryDay;
  const analysis = useSalesQuery(scope, activeBranchId, range.from, to, grain, enabled && !samePeriod);
  const chart = samePeriod ? daily : analysis;
  const refreshDaily = daily.refresh;
  const refreshAnalysis = analysis.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshDaily(), refreshAnalysis()]);
  }, [refreshDaily, refreshAnalysis]);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals", "kitchen_orders"], isReady && allowed);
  const data = daily.data;
  const error = daily.error;

  if (!allowed) return (
    <main className="space-y-4 p-4 sm:p-6">
      <header><h1 className="text-xl font-semibold">Công việc</h1><p className="text-sm text-muted-foreground">{branch?.name}</p></header>
      <nav aria-label="Nghiệp vụ" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {WORK.filter(item => hasPermission(item.permission)).map(item => (
          <Link key={item.href} href={item.href} className="flex min-h-20 items-center gap-3 rounded-md border p-3 text-sm font-medium hover:bg-muted">
            <Icon name={item.icon} size={22} /><span>{item.label}</span>
          </Link>
        ))}
      </nav>
      {unpaidBills}
    </main>
  );

  return (
    <main className="min-w-0 space-y-5 p-3 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-xl font-bold text-foreground">Tổng quan bán hàng</h1><p className="break-words text-sm text-foreground/70">{branch?.name ?? "Tất cả chi nhánh"}</p></div>
        <Button variant="outline" size="icon" aria-label="Làm mới" title="Làm mới" disabled={daily.loading || analysis.loading} onClick={() => void refresh()}><Icon name="refresh" size={19} /></Button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2 border-y py-2">
        <label htmlFor="sales-day" className="text-sm font-semibold">{summaryDay === today ? "Doanh số hôm nay" : "Doanh số theo ngày"}</label>
        <div className="flex items-center gap-2">
          <input id="sales-day" type="date" aria-label="Ngày bán hàng" max={today} value={summaryDay} onChange={event => { const next = event.target.value; if (next && next <= today) setSummaryAnchor(next); }} className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" />
          <Button size="sm" variant="ghost" onClick={() => setSummaryAnchor(null)}>Hôm nay</Button>
        </div>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-l-4 border-destructive bg-destructive/5 p-3 text-sm"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void daily.refresh()}>Thử lại</Button></div>}
      {!data && !error && <div role="status" aria-label="Đang tải doanh số" className="h-56 animate-pulse rounded-md bg-muted" />}
      {data && <>
        <section aria-labelledby="sales-title" className="overflow-hidden rounded-md border border-border/80 bg-card shadow-sm">
          <div className="border-l-4 border-primary bg-primary/5 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 id="sales-title" className="text-sm font-semibold text-primary">Doanh số thực tế</h2><span className="text-xs text-muted-foreground">Đồng</span></div>
            <p className="mt-1 text-[28px] font-semibold leading-tight tabular-nums text-primary sm:text-[32px]" data-testid="net-sales">{formatCurrency(data.sales)}</p>
            <p className="mt-1 text-xs text-foreground/70">Sau giảm giá và hàng trả</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{formatNumber(data.orders)}</strong> hóa đơn hoàn tất</span>
              <span title="Giá trị hóa đơn hoàn tất sau giảm giá, trước hàng trả phát sinh trong ngày.">Bình quân / HĐ <strong className="text-foreground tabular-nums" data-testid="average-order-value">{data.orders > 0 ? formatCurrency((data.sales + data.returns) / data.orders) : "—"}</strong></span>
              <span className="text-amber-700 dark:text-amber-400">Giảm giá {formatCurrency(data.discounts)}</span>
              {data.returns !== 0 && <span className="text-rose-700 dark:text-rose-400">Hàng trả {formatCurrency(data.returns)}</span>}
            </div>
          </div>
          <dl className="grid grid-cols-2 border-t bg-muted/30 sm:grid-cols-3">
            {Array.from(new Set(["cash", "transfer", ...Object.keys(data.methods).filter(method => data.methods[method] !== 0)])).map(method => (
              <div key={method} className={`min-w-0 border-b p-3 sm:px-5 ${method === "cash" ? "border-l-2 border-l-teal-500 bg-teal-500/5" : method === "transfer" ? "border-l-2 border-l-violet-500 bg-violet-500/5" : ""}`}><dt className={`text-xs font-medium ${method === "cash" ? "text-teal-700 dark:text-teal-400" : method === "transfer" ? "text-violet-700 dark:text-violet-400" : "text-foreground/70"}`}>{METHODS[method] ?? method}</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums">{formatCurrency(data.methods[method] ?? 0)}</dd></div>
            ))}
            <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 border-b bg-primary/5 p-3 sm:col-span-1 sm:block sm:px-5"><dt className="text-xs font-medium text-foreground/70">Thực thu sau hoàn</dt><dd className="break-words text-base font-semibold tabular-nums sm:mt-1">{formatCurrency(data.collected)}</dd></div>
          </dl>
          <details className="p-3 text-xs sm:px-5">
            <summary className="cursor-pointer font-medium">Đối chiếu bán hàng và thu tiền</summary>
            <dl className="mt-3 space-y-2">
              {[["Tiền đã thu", data.received], ["Tiền đã hoàn", -data.refunded], ["Thu tiền trừ doanh số", data.collected - data.sales]].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3"><dt>{label}</dt><dd className="tabular-nums">{formatCurrency(Number(value))}</dd></div>)}
            </dl>
            <p className="mt-3 leading-relaxed text-muted-foreground">Doanh số theo ngày hóa đơn và hàng trả, gồm thuế/phí giao nếu có. Tiền theo ngày ghi sổ, có thể gồm thu nợ cũ hoặc hoàn hóa đơn kỳ trước. Không phải lợi nhuận.</p>
          </details>
        </section>
        <p className="text-right text-xs text-muted-foreground">Cập nhật {daily.at}</p>
      </>}
      {unpaidBills}
      <section aria-labelledby="analysis-title" className="min-w-0 space-y-3 border-t pt-4">
        <h2 id="analysis-title" className="text-base font-semibold">Phân tích bán hàng</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Nhóm thời gian biểu đồ" className="flex rounded-md bg-muted p-1">
            {GRAINS.map(item => <Button key={item.value} size="sm" variant={grain === item.value ? "default" : "ghost"} aria-pressed={grain === item.value} onClick={() => setGrain(item.value)}>{item.label}</Button>)}
          </div>
          <input type="date" aria-label="Ngày tham chiếu biểu đồ" max={today} value={date} onChange={event => { const next = event.target.value; if (next && next <= today) setAnchor(next); }} className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" />
        </div>
        {!samePeriod && chart.error && <div role="alert" className="border-l-4 border-destructive bg-destructive/5 p-3 text-sm">Biểu đồ: {chart.error} <Button size="sm" variant="outline" onClick={() => void chart.refresh()}>Tải lại biểu đồ</Button></div>}
        {!chart.data && !chart.error && <div role="status" aria-label="Đang tải phân tích" className="h-60 animate-pulse bg-muted" />}
        {chart.data && <SalesCharts buckets={chart.data.buckets} modes={chart.data.modes} grain={grain} period={range.label} />}
      </section>
    </main>
  );
}
