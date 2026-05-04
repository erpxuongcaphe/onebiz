"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  formatCurrency,
  formatNumber,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import { DateRangeBar, KpiCard, ChartCard } from "./_components";
import { useBranchFilter } from "@/lib/contexts";
import {
  getOverviewKpis,
  getDailyRevenue,
  getRevenueByCategory,
  getTopProductsByRevenue,
} from "@/lib/services";
import type {
  MonthlyRevenuePoint,
  CategoryRevenue,
  TopProductRevenue,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";

// === Helpers ===

function calcChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% so với tháng trước`;
}

// === Custom tooltip ===
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-border rounded-lg ambient-shadow p-2.5 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function TongQuanPage() {
  const { activeBranchId } = useBranchFilter();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<{
    revenue: number; prevRevenue: number;
    orders: number; prevOrders: number;
    newCustomers: number; prevNewCustomers: number;
    profit: number; prevProfit: number;
  } | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [categoryRevenue, setCategoryRevenue] = useState<CategoryRevenue[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRevenue[]>([]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [kpiData, daily, category, products] = await Promise.all([
          getOverviewKpis(activeBranchId),
          getDailyRevenue(30, activeBranchId),
          getRevenueByCategory(activeBranchId),
          getTopProductsByRevenue(10, activeBranchId),
        ]);
        setKpis(kpiData);
        setDailyRevenue(daily);
        setCategoryRevenue(category);
        setTopProducts(products);
      } catch (err) {
        console.error("Failed to fetch analytics data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeBranchId]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <DateRangeBar title="Tổng quan" subtitle="Phân tích kinh doanh tổng hợp" />
        <div className="flex-1 flex items-center justify-center">
          <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <DateRangeBar title="Tổng quan" subtitle="Phân tích kinh doanh tổng hợp" />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={formatCurrency(kpis?.revenue ?? 0) + "đ"}
            change={calcChange(kpis?.revenue ?? 0, kpis?.prevRevenue ?? 0)}
            positive={(kpis?.revenue ?? 0) >= (kpis?.prevRevenue ?? 0)}
            icon="attach_money"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Đơn hàng"
            value={formatNumber(kpis?.orders ?? 0)}
            change={calcChange(kpis?.orders ?? 0, kpis?.prevOrders ?? 0)}
            positive={(kpis?.orders ?? 0) >= (kpis?.prevOrders ?? 0)}
            icon="shopping_cart"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Khách mới"
            value={formatNumber(kpis?.newCustomers ?? 0)}
            change={calcChange(kpis?.newCustomers ?? 0, kpis?.prevNewCustomers ?? 0)}
            positive={(kpis?.newCustomers ?? 0) >= (kpis?.prevNewCustomers ?? 0)}
            icon="group"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Lợi nhuận"
            value={formatCurrency(kpis?.profit ?? 0) + "đ"}
            change={calcChange(kpis?.profit ?? 0, kpis?.prevProfit ?? 0)}
            positive={(kpis?.profit ?? 0) >= (kpis?.prevProfit ?? 0)}
            icon="trending_up"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue line chart */}
          <ChartCard title="Doanh thu theo ngày" subtitle="30 ngày gần nhất">
            {dailyRevenue.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                Chưa có dữ liệu doanh thu theo ngày
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    interval={4}
                  />
                  <YAxis
                    tickFormatter={formatChartCurrency}
                    tick={{ fontSize: 11 }}
                    width={48}
                  />
                  <Tooltip content={<RevenueTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Doanh thu"
                    stroke="#004AC6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Revenue by category bar chart */}
          <ChartCard title="Doanh thu theo danh mục" subtitle="Tháng hiện tại">
            {categoryRevenue.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                Chưa có dữ liệu doanh thu theo danh mục
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={categoryRevenue} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    tickFormatter={formatChartCurrency}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<RevenueTooltip />} />
                  <Bar
                    dataKey="revenue"
                    name="Doanh thu"
                    fill="#004AC6"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Top 10 products table */}
        <ChartCard title="Top 10 sản phẩm bán chạy" subtitle="Theo doanh thu tháng này">
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Chưa có dữ liệu sản phẩm bán chạy
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium w-8">#</th>
                    <th className="pb-2 pr-4 font-medium">Sản phẩm</th>
                    <th className="pb-2 pr-4 font-medium text-right">SL bán</th>
                    <th className="pb-2 font-medium text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-surface-container-low">
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="py-2 pr-4 font-medium text-foreground">{p.name}</td>
                      <td className="py-2 pr-4 text-right text-foreground">{p.qty}</td>
                      <td className="py-2 text-right font-semibold text-primary">
                        {formatCurrency(p.revenue)}đ
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
