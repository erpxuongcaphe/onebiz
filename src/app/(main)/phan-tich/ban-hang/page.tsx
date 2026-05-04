"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import { useBranchFilter } from "@/lib/contexts";
import {
  formatCurrency,
  formatNumber,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getSalesKpis,
  getDailyRevenue,
  getSalesRevenueByWeekday,
  getSalesRevenueByHour,
  getTopInvoices,
} from "@/lib/services";
import type {
  MonthlyRevenuePoint,
  ChartPoint,
  TopInvoice,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";

// === Helpers ===

function calcChangePct(
  current: number,
  previous: number,
): { text: string; positive: boolean } {
  if (previous === 0)
    return { text: current > 0 ? "+100%" : "0%", positive: current >= 0 };
  const pct = ((current - previous) / previous) * 100;
  return {
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    positive: pct >= 0,
  };
}

const DAY_COLORS = [
  "#64748b",
  "#64748b",
  "#64748b",
  "#64748b",
  "#004AC6",
  "#16a34a",
  "#16a34a",
];

// === Custom Tooltips ===

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
      <p className="text-xs text-muted-foreground mb-1">Ngày {label}</p>
      <p className="text-sm font-bold text-primary">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function DayOfWeekTooltip({
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
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-status-success">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function HourlyTooltip({
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
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-status-info">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

// === Page ===

interface SalesKpisData {
  netRevenue: number;
  prevNetRevenue: number;
  soldQty: number;
  prevSoldQty: number;
  avgOrderValue: number;
  prevAvgOrderValue: number;
  returnRate: number;
  prevReturnRate: number;
}

export default function BanHangPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<SalesKpisData | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [revenueByWeekday, setRevenueByWeekday] = useState<ChartPoint[]>([]);
  const [revenueByHour, setRevenueByHour] = useState<ChartPoint[]>([]);
  const [topInvoicesList, setTopInvoicesList] = useState<TopInvoice[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [kpisData, daily, weekday, hourly, invoices] = await Promise.all([
        getSalesKpis(activeBranchId),
        getDailyRevenue(30, activeBranchId),
        getSalesRevenueByWeekday(activeBranchId),
        getSalesRevenueByHour(activeBranchId),
        getTopInvoices(10, activeBranchId),
      ]);
      setKpis(kpisData);
      setDailyRevenue(daily);
      setRevenueByWeekday(weekday);
      setRevenueByHour(hourly);
      setTopInvoicesList(invoices);
    } catch (err) {
      console.error("Failed to fetch sales analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] items-center justify-center">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Đang tải dữ liệu phân tích...
        </p>
      </div>
    );
  }

  const hasData =
    kpis ||
    dailyRevenue.length > 0 ||
    revenueByWeekday.length > 0 ||
    revenueByHour.length > 0 ||
    topInvoicesList.length > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <DateRangeBar
          title="Phân tích bán hàng"
          subtitle="Thống kê doanh thu và đơn hàng theo thời gian"
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">
            Chưa có dữ liệu bán hàng trong khoảng thời gian này.
          </p>
        </div>
      </div>
    );
  }

  const revenueChange = kpis
    ? calcChangePct(kpis.netRevenue, kpis.prevNetRevenue)
    : { text: "0%", positive: true };
  const qtyChange = kpis
    ? calcChangePct(kpis.soldQty, kpis.prevSoldQty)
    : { text: "0%", positive: true };
  const avgChange = kpis
    ? calcChangePct(kpis.avgOrderValue, kpis.prevAvgOrderValue)
    : { text: "0%", positive: true };
  const returnChange = kpis
    ? calcChangePct(kpis.returnRate, kpis.prevReturnRate)
    : { text: "0%", positive: true };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích bán hàng"
        subtitle="Thống kê doanh thu và đơn hàng theo thời gian"
      />

      <div className="flex-1 p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu thuần"
            value={formatCurrency(kpis?.netRevenue ?? 0) + "đ"}
            change={`${revenueChange.text} so với tháng trước`}
            positive={revenueChange.positive}
            icon="trending_up"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Số lượng bán"
            value={formatNumber(kpis?.soldQty ?? 0)}
            change={`${qtyChange.text} so với tháng trước`}
            positive={qtyChange.positive}
            icon="inventory_2"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Giá trị trung bình/đơn"
            value={formatCurrency(kpis?.avgOrderValue ?? 0) + "đ"}
            change={`${avgChange.text} so với tháng trước`}
            positive={avgChange.positive}
            icon="receipt"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tỷ lệ trả hàng"
            value={`${(kpis?.returnRate ?? 0).toFixed(1)}%`}
            change={`${returnChange.text} so với tháng trước`}
            positive={!returnChange.positive}
            icon="undo"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
        </div>

        {/* Daily Revenue Trend */}
        {dailyRevenue.length > 0 && (
          <ChartCard
            title="Xu hướng doanh thu 30 ngày"
            subtitle="Dữ liệu thực tế"
          >
            <div className="h-56 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={dailyRevenue}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={4}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatChartCurrency(v)}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip content={<RevenueTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#004AC6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, fill: "#004AC6" }}
                    name="Doanh thu"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue by Day of Week */}
          {revenueByWeekday.length > 0 && (
            <ChartCard
              title="Doanh thu theo thứ trong tuần"
              subtitle="Trung bình 30 ngày gần nhất"
            >
              <div className="h-56 md:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={revenueByWeekday}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <Tooltip content={<DayOfWeekTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[6, 6, 0, 0]}
                      name="Doanh thu"
                    >
                      {revenueByWeekday.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={DAY_COLORS[index % DAY_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {/* Revenue by Hour */}
          {revenueByHour.length > 0 && (
            <ChartCard
              title="Doanh thu theo giờ trong ngày"
              subtitle="Trung bình 30 ngày gần nhất"
            >
              <div className="h-56 md:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={revenueByHour}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={2}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={45}
                    />
                    <Tooltip content={<HourlyTooltip />} />
                    <defs>
                      <linearGradient
                        id="colorRevHour"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#9333ea"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#9333ea"
                          stopOpacity={0.05}
                        />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#9333ea"
                      strokeWidth={2}
                      fill="url(#colorRevHour)"
                      name="Doanh thu"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}
        </div>

        {/* Top 10 Invoices Table */}
        {topInvoicesList.length > 0 && (
          <ChartCard
            title="Top 10 hóa đơn giá trị cao nhất"
            subtitle="Tháng hiện tại"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Mã HĐ</th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Khách hàng
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Giá trị
                    </th>
                    <th className="text-right py-2 font-medium">Ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {topInvoicesList.map((inv) => (
                    <tr key={inv.code} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-mono text-xs text-primary">
                        {inv.code}
                      </td>
                      <td className="py-2.5 pr-4 font-medium">
                        {inv.customer}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium text-primary">
                        {formatCurrency(inv.value)}đ
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        {inv.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
