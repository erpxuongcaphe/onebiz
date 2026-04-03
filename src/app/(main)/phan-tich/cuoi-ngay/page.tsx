"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  ShoppingCart,
  Banknote,
  CreditCard,
  Landmark,
  RotateCcw,
} from "lucide-react";
import { Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import {
  getEndOfDayStats,
  getSalesRevenueByHour,
  getTodayTopProducts,
} from "@/lib/services";
import type { EndOfDayStats, ChartPoint } from "@/lib/services/supabase/analytics";

/* ---------- helpers ---------- */

function calcChangePct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/* ---------- custom tooltips ---------- */

function HourTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-2.5 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const total = d.payload.total as number;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-2.5 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{d.name}</p>
      <p style={{ color: d.payload.color }}>
        {formatChartTooltipCurrency(d.value)} ({total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%)
      </p>
    </div>
  );
}

function ProductTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-2.5 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      <p style={{ color: payload[0].color }}>
        Số lượng: {payload[0].value}
      </p>
    </div>
  );
}

/* ---------- main page ---------- */

export default function CuoiNgayPage() {
  const [stats, setStats] = useState<EndOfDayStats | null>(null);
  const [revenueByHour, setRevenueByHour] = useState<ChartPoint[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, hourData, productsData] = await Promise.all([
        getEndOfDayStats(),
        getSalesRevenueByHour(),
        getTodayTopProducts(),
      ]);
      setStats(statsData);
      setRevenueByHour(hourData);
      setTopProducts(productsData);
    } catch (err) {
      console.error("Failed to fetch end-of-day data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* --- loading state --- */
  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <DateRangeBar
          title="Báo cáo cuối ngày"
          subtitle="Tổng kết hoạt động kinh doanh trong ngày"
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  /* --- empty state --- */
  if (!stats) {
    return (
      <div className="flex flex-col h-full">
        <DateRangeBar
          title="Báo cáo cuối ngày"
          subtitle="Tổng kết hoạt động kinh doanh trong ngày"
        />
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Không có dữ liệu cuối ngày.
        </div>
      </div>
    );
  }

  /* --- derived data --- */
  const {
    totalRevenue,
    totalOrders,
    cashAmount,
    transferAmount,
    cardAmount,
    returnAmount,
    previousRevenue,
    previousOrders,
  } = stats;

  const revenuePct = calcChangePct(totalRevenue, previousRevenue);
  const ordersDiff = totalOrders - previousOrders;

  const paymentMethods = [
    { name: "Tiền mặt", value: cashAmount, color: "#22c55e", total: totalRevenue },
    { name: "Chuyển khoản", value: transferAmount, color: "#3b82f6", total: totalRevenue },
    { name: "Thẻ", value: cardAmount, color: "#f97316", total: totalRevenue },
  ];

  const hourChartData = revenueByHour.map((p) => ({
    hour: p.label,
    revenue: p.value,
  }));

  return (
    <div className="flex flex-col h-full">
      <DateRangeBar
        title="Báo cáo cuối ngày"
        subtitle="Tổng kết hoạt động kinh doanh trong ngày"
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            label="Tổng doanh thu"
            value={formatCurrency(totalRevenue) + "đ"}
            change={`${revenuePct >= 0 ? "+" : ""}${revenuePct.toFixed(1)}% so với hôm qua`}
            positive={revenuePct >= 0}
            icon={DollarSign}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Tổng đơn hàng"
            value={String(totalOrders)}
            change={`${ordersDiff >= 0 ? "+" : ""}${ordersDiff} đơn so với hôm qua`}
            positive={ordersDiff >= 0}
            icon={ShoppingCart}
            bg="bg-emerald-50"
            iconColor="text-emerald-600"
            valueColor="text-emerald-700"
          />
          <KpiCard
            label="Tiền mặt"
            value={formatCurrency(cashAmount) + "đ"}
            icon={Banknote}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Chuyển khoản"
            value={formatCurrency(transferAmount) + "đ"}
            icon={Landmark}
            bg="bg-indigo-50"
            iconColor="text-indigo-600"
            valueColor="text-indigo-700"
          />
          <KpiCard
            label="Thẻ"
            value={formatCurrency(cardAmount) + "đ"}
            icon={CreditCard}
            bg="bg-amber-50"
            iconColor="text-amber-600"
            valueColor="text-amber-700"
          />
          <KpiCard
            label="Trả hàng"
            value={formatCurrency(returnAmount) + "đ"}
            positive={false}
            icon={RotateCcw}
            bg="bg-red-50"
            iconColor="text-red-500"
            valueColor="text-red-600"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue by hour */}
          <ChartCard title="Doanh thu theo giờ" subtitle="Phân bổ doanh thu trong ngày">
            {hourChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={hourChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10 }}
                    interval={2}
                  />
                  <YAxis
                    tickFormatter={formatChartCurrency}
                    tick={{ fontSize: 11 }}
                    width={48}
                  />
                  <Tooltip content={<HourTooltip />} />
                  <Bar
                    dataKey="revenue"
                    name="Doanh thu"
                    fill="#2563eb"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                Chưa có dữ liệu doanh thu theo giờ.
              </div>
            )}
          </ChartCard>

          {/* Payment method pie */}
          <ChartCard title="Phương thức thanh toán" subtitle="Tỷ lệ theo giá trị">
            {totalRevenue > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={paymentMethods}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }: any) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {paymentMethods.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                Chưa có dữ liệu thanh toán.
              </div>
            )}
          </ChartCard>
        </div>

        {/* Summary table + Top products */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Payment summary table */}
          <ChartCard title="Tổng hợp thanh toán" subtitle="Chi tiết theo phương thức">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4 font-medium">Phương thức</th>
                    <th className="pb-2 pr-4 font-medium text-right">Số tiền</th>
                    <th className="pb-2 font-medium text-right">Tỷ lệ</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMethods.map((m, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: m.color }}
                          />
                          <span className="font-medium text-gray-800">{m.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-gray-800">
                        {formatCurrency(m.value)}đ
                      </td>
                      <td className="py-2.5 text-right text-gray-500">
                        {totalRevenue > 0 ? ((m.value / totalRevenue) * 100).toFixed(1) : "0.0"}%
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-bold">
                    <td className="py-2.5 pr-4 text-gray-800">Tổng cộng</td>
                    <td className="py-2.5 pr-4 text-right text-blue-700">
                      {formatCurrency(totalRevenue)}đ
                    </td>
                    <td className="py-2.5 text-right text-gray-800">100%</td>
                  </tr>
                  <tr className="text-red-500">
                    <td className="py-2.5 pr-4">Trả hàng</td>
                    <td className="py-2.5 pr-4 text-right font-semibold">
                      -{formatCurrency(returnAmount)}đ
                    </td>
                    <td className="py-2.5 text-right">
                      {totalRevenue > 0 ? ((returnAmount / totalRevenue) * 100).toFixed(1) : "0.0"}%
                    </td>
                  </tr>
                  <tr className="border-t-2 font-bold text-emerald-700">
                    <td className="py-2.5 pr-4">Doanh thu thực</td>
                    <td className="py-2.5 pr-4 text-right">
                      {formatCurrency(totalRevenue - returnAmount)}đ
                    </td>
                    <td className="py-2.5 text-right">
                      {totalRevenue > 0
                        ? (((totalRevenue - returnAmount) / totalRevenue) * 100).toFixed(1)
                        : "0.0"}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* Top 5 products horizontal bar */}
          <ChartCard title="Top 5 sản phẩm bán chạy hôm nay" subtitle="Theo số lượng bán">
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<ProductTooltip />} />
                  <Bar
                    dataKey="qty"
                    name="Số lượng"
                    fill="#10b981"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                Chưa có sản phẩm bán hôm nay.
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
