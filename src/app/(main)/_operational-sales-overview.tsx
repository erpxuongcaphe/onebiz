"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import { useHubAccess } from "@/lib/operations/use-hub-access";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { useReceivingVietnamDay } from "@/lib/hooks/use-receiving-view-memory";
import { canViewSalesDashboard, salesRange, type SalesDashboard, type SalesGrain } from "@/lib/dashboard-sales";
import { getSalesDashboard, getSalesDayReceivable, getCollectionReconciliation, type CollectionReconciliation } from "@/lib/services/supabase/dashboard-sales";
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

function CollectionDetails({ branchId, day, refreshKey }: { branchId: string | undefined; day: string; refreshKey: number }) {
  const [data, setData] = useState<CollectionReconciliation | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null); setError(false);
    getCollectionReconciliation(branchId, day).then(value => { if (active) setData(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [branchId, day, revision, refreshKey]);
  const methodName = (key: string) => METHODS[key] ?? key;
  return <section className="border-t p-4 sm:p-5" aria-label="Đối chiếu tiền thu">
    <h3 className="font-semibold">Tiền thu trong ngày</h3>
    <p className="mt-1 text-xs text-muted-foreground">Theo ngày ghi sổ, sau tiền hoàn; có thể gồm thu nợ cũ.</p>
    {error && <p role="alert" className="mt-2 text-sm">Chưa tải được đối chiếu tiền thu. <button className="underline" onClick={() => setRevision(value => value + 1)}>Thử lại</button></p>}
    {!data && !error && <p role="status" className="mt-2 text-sm">Đang tải tiền thu...</p>}
    {data && <>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Tổng tiền thu</dt><dd className="mt-1 font-semibold tabular-nums">{formatCurrency(data.total.net)} đ</dd></div>
        <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Trong đó: thu nội bộ</dt><dd className="mt-1 font-semibold tabular-nums">{formatCurrency(data.internal.net)} đ</dd></div>
        <div className="rounded-md border border-primary/40 border-l-4 border-l-primary bg-primary/5 p-3"><dt className="text-xs font-medium text-primary">Tiền thu không gồm nội bộ</dt><dd className="mt-1 font-semibold tabular-nums text-primary">{formatCurrency(data.external.net)} đ</dd></div>
      </dl>
      <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Xem tiền mặt, chuyển khoản và tiền hoàn</summary>
        {([["Khách ngoài", data.external], ["Nội bộ", data.internal]] as const).map(([label, part]) => <div key={label} className="mt-3 rounded-md border p-3">
          <p className="font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">Đã thu {formatCurrency(part.received)} đ · Đã hoàn {formatCurrency(part.refunded)} đ</p>
          {Object.entries(part.methods).map(([method, value]) => <p className="mt-1 text-xs" key={method}>{methodName(method)} sau hoàn: {formatCurrency(value)} đ</p>)}
        </div>)}
      </details>
    </>}
  </section>;
}

function BranchSalesDetails({ branches, day }: { branches: { id: string; name: string }[]; day: string }) {
  const [open, setOpen] = useState<"sales" | "payments" | null>(null);
  const [result, setResult] = useState<{ day: string; rows: { name: string; data: SalesDashboard }[] } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(false);
    Promise.all(branches.map(async branch => ({ name: branch.name, data: await getSalesDashboard(branch.id, day, day, "hour") })))
      .then(rows => { if (active) setResult({ day, rows }); })
      .catch(() => { if (active) { setResult(null); setError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, branches, day]);
  return <div className="space-y-2 px-4 pb-4 sm:px-5">
    {(["sales", "payments"] as const).map(kind => <div key={kind} className="rounded-md border">
      <button type="button" aria-expanded={open === kind} className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium" onClick={() => setOpen(open === kind ? null : kind)}>
        {kind === "sales" ? "Doanh số từng chi nhánh" : "Thanh toán từng chi nhánh"}<Icon name={open === kind ? "expand_less" : "expand_more"} size={20} />
      </button>
      {open === kind && <div className="space-y-2 border-t p-3 text-sm">
        {loading && <p role="status">Đang tải...</p>}
        {!loading && error && <p role="alert">Chưa tải được chi tiết chi nhánh. Đóng và mở lại để thử lại.</p>}
        {!loading && !error && result?.day === day && result.rows.map(row => <div key={row.name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2 last:border-0">
          <span className="font-medium">{row.name}</span>
          {kind === "sales" ? <span className="tabular-nums">{formatCurrency(row.data.sales)} đ</span> : <span className="text-right tabular-nums">Tiền mặt: {formatCurrency(row.data.methods.cash ?? 0)} đ · Chuyển khoản: {formatCurrency(row.data.methods.transfer ?? 0)} đ · Thực thu sau hoàn: {formatCurrency(row.data.collected)} đ</span>}
        </div>)}
        {kind === "payments" && <p className="text-xs text-muted-foreground">Tiền thu theo ngày ghi sổ, có thể gồm thu nợ cũ; thực thu đã trừ tiền hoàn.</p>}
      </div>}
    </div>)}
  </div>;
}

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
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => { active = false; request.current += 1; };
  }, [refresh]);
  const error = enabled && failure?.key === key ? failure.message : null;
  return { data: enabled && !error && result?.key === key ? result.data : null, error, at: !error && result?.key === key ? result.at : null, loading: enabled && loading, refresh };
}

function useSalesReceivable(scope: string, branchId: string | undefined, day: string, enabled: boolean) {
  const key = `${scope}:${branchId ?? "all"}:${day}:${enabled}`;
  const [result, setResult] = useState<{key: string; amount: number; invoice_count: number; missing_count: number} | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    if (!enabled) return;
    try {
      const data = await getSalesDayReceivable(branchId, day);
      if (request.current === id) { setResult({key, ...data}); setFailed(null); }
    } catch {
      if (request.current === id) setFailed(key);
    }
  }, [branchId, day, enabled, key]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => { active = false; request.current += 1; };
  }, [refresh]);
  return {data: enabled && failed !== key && result?.key === key ? result : null, error: failed === key, refresh};
}

export default function OperationalSalesOverview() {
  const hubAllowed = useHubAccess();
  const { activeBranchId, isReady } = useBranchFilter();
  const { tenant, user, branches, hasPermission } = useAuth();
  const detailBranches = useMemo(() => branches.map(item => ({ id: item.id, name: item.name })), [branches]);
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
  const receivable = useSalesReceivable(scope, activeBranchId, summaryDay, enabled && hasPermission("customers.view_debt"));
  const samePeriod = grain === "hour" && range.from === summaryDay && to === summaryDay;
  const analysis = useSalesQuery(scope, activeBranchId, range.from, to, grain, enabled && !samePeriod);
  const chart = samePeriod ? daily : analysis;
  const refreshDaily = daily.refresh;
  const refreshAnalysis = analysis.refresh;
  const refreshReceivable = receivable.refresh;
  const [collectionRefreshKey, setCollectionRefreshKey] = useState(0);
  const refresh = useCallback(async () => {
    setCollectionRefreshKey(value => value + 1);
    await Promise.all([refreshDaily(), refreshAnalysis(), refreshReceivable()]);
  }, [refreshDaily, refreshAnalysis, refreshReceivable]);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals", "kitchen_orders"], isReady && allowed);
  const data = daily.data;
  const error = daily.error;

  if (!allowed) return (
    <main className="space-y-4 p-4 sm:p-6">
      <header><h1 className="text-xl font-semibold">Công việc</h1><p className="text-sm text-muted-foreground">{branch?.name}</p></header>
      <nav aria-label="Nghiệp vụ" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {WORK.filter(item => item.permission === "ops.view" ? hubAllowed : hasPermission(item.permission)).map(item => (
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
          {!activeBranchId && <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
            <div className="min-w-0 rounded-md border bg-background p-4">
              <h2 id="sales-title" className="text-sm font-semibold">Tổng doanh thu</h2>
              <p className="mt-1 break-words text-2xl font-semibold tabular-nums sm:text-3xl" data-testid="all-branch-sales">{data.internal_net === undefined ? "—" : `${formatCurrency(data.sales + data.internal_net)} đ`}</p>
              <p className="mt-1 text-xs text-muted-foreground">Bán nội bộ: {data.internal_net === undefined ? "—" : `${formatCurrency(data.internal_net)} đ`}</p>
            </div>
            <div className="min-w-0 rounded-md border border-primary/40 border-l-4 border-l-primary bg-primary/5 p-4">
              <h2 className="text-sm font-semibold text-primary">Bán khách</h2>
              <p className="mt-1 break-words text-[28px] font-bold leading-tight tabular-nums text-primary sm:text-[32px]" data-testid="net-sales">{formatCurrency(data.sales)} đ</p>
              <p className="mt-1 text-xs text-muted-foreground">Sau khi trừ phần bán nội bộ</p>
            </div>
          </div>}
          {!activeBranchId && <BranchSalesDetails branches={detailBranches} day={summaryDay} />}
          {activeBranchId && <div className="border-l-4 border-primary bg-primary/5 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 id="sales-title" className="text-sm font-semibold text-primary">{activeBranchId ? "Doanh số thực tế" : "Doanh số toàn chuỗi · đã loại nội bộ"}</h2><span className="text-xs text-muted-foreground">Đồng</span></div>
            <p className="mt-1 text-[28px] font-semibold leading-tight tabular-nums text-primary sm:text-[32px]" data-testid="net-sales">{formatCurrency(data.sales)}</p>
            <p className="mt-1 text-xs text-foreground/70">Sau giảm giá và hàng trả</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{formatNumber(data.orders)}</strong> hóa đơn hoàn tất</span>
              <span title="Giá trị hóa đơn hoàn tất sau giảm giá, trước hàng trả phát sinh trong ngày.">Bình quân / HĐ <strong className="text-foreground tabular-nums" data-testid="average-order-value">{data.orders > 0 ? formatCurrency((data.sales + data.returns) / data.orders) : "—"}</strong></span>
              <span className="text-amber-700 dark:text-amber-400">Giảm giá {formatCurrency(data.discounts)}</span>
              {data.returns !== 0 && <span className="text-rose-700 dark:text-rose-400">Hàng trả {formatCurrency(data.returns)}</span>}
            </div>
          </div>}
          <CollectionDetails key={`${scope}:${activeBranchId ?? "all"}:${summaryDay}`} branchId={activeBranchId} day={summaryDay} refreshKey={collectionRefreshKey} />
          <p className="border-t px-4 pt-3 text-xs text-muted-foreground">{activeBranchId ? "Phương thức thanh toán · gồm nội bộ" : "Phương thức thanh toán · không gồm nội bộ"}</p>
          <dl className="grid grid-cols-2 bg-muted/30 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from(new Set(["cash", "transfer", ...Object.keys(data.methods).filter(method => data.methods[method] !== 0)])).map(method => (
              <div key={method} className={`min-w-0 border-b p-3 sm:px-5 ${method === "cash" ? "border-l-2 border-l-teal-500 bg-teal-500/5" : method === "transfer" ? "border-l-2 border-l-violet-500 bg-violet-500/5" : ""}`}><dt className={`text-xs font-medium ${method === "cash" ? "text-teal-700 dark:text-teal-400" : method === "transfer" ? "text-violet-700 dark:text-violet-400" : "text-foreground/70"}`}>{METHODS[method] ?? method}</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums">{formatCurrency(data.methods[method] ?? 0)}</dd></div>
            ))}
            {hasPermission("customers.view_debt") && <div className="min-w-0 border-b border-l-2 border-l-amber-500 bg-amber-500/5 p-3 sm:px-5"><dt className="text-xs font-medium text-amber-800 dark:text-amber-300">Chưa thanh toán</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums" data-testid="invoice-receivable">{receivable.data && receivable.data.missing_count === 0 ? formatCurrency(receivable.data.amount) : "—"}</dd><p className="mt-1 text-xs text-muted-foreground">{receivable.error ? "Chưa tải được công nợ." : receivable.data?.missing_count ? "Có hóa đơn chưa đủ số nợ." : "Số còn phải thu hiện tại của hóa đơn hoàn tất trong ngày đã chọn."}</p></div>}
            <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 border-b bg-primary/5 p-3 sm:col-span-1 sm:block sm:px-5"><dt className="text-xs font-medium text-foreground/70">Thực thu sau hoàn</dt><dd className="break-words text-base font-semibold tabular-nums sm:mt-1">{formatCurrency(data.collected)}</dd></div>
          </dl>
          <details className="p-3 text-xs sm:px-5">
            <summary className="cursor-pointer font-medium">Đối chiếu bán hàng và thu tiền</summary>
            <dl className="mt-3 space-y-2">
              {[["Tiền đã thu", data.received], ["Tiền đã hoàn", data.refunded === 0 ? 0 : -data.refunded], ["Chênh lệch thực thu và doanh số", data.collected - data.sales]].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3"><dt>{label}</dt><dd className="shrink-0 text-right tabular-nums">{formatCurrency(Number(value))}</dd></div>)}
            </dl>
            <p className="mt-3 leading-relaxed text-muted-foreground">Doanh số theo ngày hóa đơn và hàng trả, gồm thuế/phí giao nếu có. Thực thu sau hoàn theo ngày ghi sổ, nên có thể gồm thu nợ hoặc hoàn tiền của đơn kỳ trước.</p>
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
