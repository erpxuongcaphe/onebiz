"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SALES_MODES, salesBucketLabel, salesChartBuckets, type SalesBucket, type SalesGrain, type SalesMode } from "@/lib/dashboard-sales";
import { formatChartCurrency, formatCurrency, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";

interface Props { buckets: SalesBucket[]; modes: SalesMode[]; grain: SalesGrain; period: string }
const MODE_COLORS: Record<string, string> = {
  dine_in: "#0d9488", takeaway: "#d97706", delivery: "#8b5cf6",
  retail: "#2563eb", internal: "#0e7490", unknown: "#64748b",
};

export default function SalesOverviewCharts({ buckets, modes, grain, period }: Props) {
  const [metric, setMetric] = useState<"orders" | "sales">("orders");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const updateClock = () => setNow(new Date());
    const timer = window.setInterval(updateClock, 60_000);
    window.addEventListener("focus", updateClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateClock);
    };
  }, []);
  const trend = salesChartBuckets(buckets, grain, now);
  const hasCurrentPeriod = trend.some(row => row.current);
  const rows = modes.map(item => ({ ...item, label: SALES_MODES[item.mode] ?? "Chưa phân loại" }))
    .sort((a, b) => b[metric] - a[metric]);
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section aria-labelledby="sales-trend-title" className="min-w-0 border-t pt-4">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-primary/15 bg-primary/5 px-3 py-2"><h2 id="sales-trend-title" className="text-base font-semibold">Xu hướng doanh số</h2><span className="text-xs text-muted-foreground">{period}</span></header>
        <div className="h-56 w-full min-w-0 sm:h-64" role="img" aria-label={`Doanh số theo ${grain === "hour" ? "giờ" : grain === "day" ? "ngày" : grain === "month" ? "tháng" : "năm"}`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="key" tickFormatter={value => salesBucketLabel(String(value), grain)} minTickGap={24} tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickFormatter={formatChartCurrency} width={52} tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip labelFormatter={value => salesBucketLabel(String(value), grain)} formatter={value => [formatCurrency(Number(value)), "Doanh số"]} />
              <Area type="linear" dataKey="sales" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {hasCurrentPeriod && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Kỳ hiện tại chưa kết thúc.</p>}
        <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Bảng số liệu</summary><div className="max-h-64 overflow-auto"><table className="mt-2 w-full tabular-nums"><thead className="sticky top-0 bg-background"><tr><th scope="col" className="py-2 text-left">Thời gian</th><th scope="col" className="text-right">Số đơn</th><th scope="col" className="text-right">Doanh số</th></tr></thead><tbody>{trend.map(row => <tr key={row.key} className="border-t"><td className="py-2">{salesBucketLabel(row.key, grain)}{row.pending ? <span className="ml-2 text-muted-foreground">Chưa đến</span> : row.current ? <span className="ml-2 text-amber-700 dark:text-amber-400">Đang diễn ra</span> : null}</td><td className="text-right">{row.orders === null ? "—" : formatNumber(row.orders)}</td><td className="text-right">{row.sales === null ? "—" : formatCurrency(row.sales)}</td></tr>)}</tbody></table></div></details>
      </section>
      <section aria-labelledby="sales-mode-title" className="min-w-0 border-t pt-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-teal-600/20 bg-teal-600/5 px-3 py-2"><h2 id="sales-mode-title" className="text-base font-semibold">Hình thức bán</h2><div role="group" aria-label="Chỉ tiêu hình thức bán" className="flex rounded-md bg-background p-1">{(["orders", "sales"] as const).map(value => <Button key={value} size="sm" variant={metric === value ? "default" : "ghost"} aria-pressed={metric === value} onClick={() => setMetric(value)}>{value === "orders" ? "Số đơn" : "Doanh số"}</Button>)}</div></header>
        {rows.length ? <>
          <div className="h-56 w-full min-w-0 sm:h-64" role="img" aria-label="Cơ cấu tại chỗ, mang về và giao hàng">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tickFormatter={metric === "sales" ? formatChartCurrency : value => formatNumber(Number(value))} allowDecimals={metric !== "orders"} axisLine={false} tickLine={false} fontSize={11} />
                <YAxis type="category" dataKey="label" width={96} axisLine={false} tickLine={false} fontSize={11} />
                <Tooltip formatter={value => [metric === "sales" ? formatCurrency(Number(value)) : formatNumber(Number(value)), metric === "sales" ? "Doanh số" : "Số đơn"]} />
                <Bar dataKey={metric} barSize={22} isAnimationActive={false}>{rows.map(row => <Cell key={row.mode} fill={MODE_COLORS[row.mode] ?? MODE_COLORS.unknown} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Bảng số liệu</summary><table className="mt-2 w-full tabular-nums"><thead><tr><th className="py-2 text-left">Hình thức</th><th className="text-right">Số đơn</th><th className="text-right">Doanh số</th></tr></thead><tbody>{rows.map(row => <tr key={row.mode} className="border-t"><td className="py-2">{row.label}</td><td className="text-right">{formatNumber(row.orders)}</td><td className="text-right">{formatCurrency(row.sales)}</td></tr>)}</tbody></table></details>
        </> : <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">Chưa có đơn hoàn tất trong kỳ.</p>}
      </section>
    </div>
  );
}
