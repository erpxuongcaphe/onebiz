"use client";

import { DollarSign, ShoppingCart, Users, TrendingUp } from "lucide-react";
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
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import { DateRangeBar, KpiCard, ChartCard } from "./_components";

// === Mock: 30 ngày doanh thu ===
const revenueByDay = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 2, i + 1);
  const base = 25_000_000 + Math.sin(i * 0.5) * 8_000_000;
  const noise = (Math.random() - 0.5) * 6_000_000;
  return {
    date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
    revenue: Math.round(base + noise),
  };
});

// === Mock: Doanh thu theo danh mục ===
const revenueByCategory = [
  { category: "Cà phê rang xay", revenue: 185_000_000 },
  { category: "Cà phê hoà tan", revenue: 92_000_000 },
  { category: "Trà & Thảo mộc", revenue: 58_000_000 },
  { category: "Máy pha cà phê", revenue: 45_000_000 },
  { category: "Phụ kiện pha chế", revenue: 32_000_000 },
  { category: "Bánh & Snack", revenue: 21_000_000 },
];

// === Mock: Top 10 sản phẩm ===
const topProducts = [
  { name: "Cà phê Robusta Đắk Lắk 500g", qty: 342, revenue: 68_400_000 },
  { name: "Cà phê Arabica Cầu Đất 250g", qty: 285, revenue: 57_000_000 },
  { name: "Cà phê sữa hoà tan 3in1 (hộp 20)", qty: 264, revenue: 39_600_000 },
  { name: "Trà ô long Bảo Lộc 200g", qty: 198, revenue: 29_700_000 },
  { name: "Cà phê Blend House đặc biệt 1kg", qty: 156, revenue: 46_800_000 },
  { name: "Phin nhôm cao cấp", qty: 148, revenue: 14_800_000 },
  { name: "Cà phê Moka Lâm Đồng 250g", qty: 132, revenue: 33_000_000 },
  { name: "Bộ drip V60 Hario", qty: 95, revenue: 28_500_000 },
  { name: "Bánh quy bơ hạnh nhân (hộp)", qty: 87, revenue: 8_700_000 },
  { name: "Cà phê Cold Brew chai 500ml", qty: 76, revenue: 11_400_000 },
];

// === Custom tooltip ===
function RevenueTooltip({ active, payload, label }: any) {
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

export default function TongQuanPage() {
  return (
    <div className="flex flex-col h-full">
      <DateRangeBar title="Tổng quan" subtitle="Phân tích kinh doanh tổng hợp" />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={formatCurrency(856_000_000) + "đ"}
            change="+12,5% so với tháng trước"
            positive
            icon={DollarSign}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Đơn hàng"
            value="1.247"
            change="+8,3% so với tháng trước"
            positive
            icon={ShoppingCart}
            bg="bg-emerald-50"
            iconColor="text-emerald-600"
            valueColor="text-emerald-700"
          />
          <KpiCard
            label="Khách mới"
            value="186"
            change="+23,1% so với tháng trước"
            positive
            icon={Users}
            bg="bg-violet-50"
            iconColor="text-violet-600"
            valueColor="text-violet-700"
          />
          <KpiCard
            label="Lợi nhuận"
            value={formatCurrency(214_000_000) + "đ"}
            change="-2,4% so với tháng trước"
            positive={false}
            icon={TrendingUp}
            bg="bg-amber-50"
            iconColor="text-amber-600"
            valueColor="text-amber-700"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue line chart */}
          <ChartCard title="Doanh thu theo ngày" subtitle="30 ngày gần nhất">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={revenueByDay}>
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
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Doanh thu"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Revenue by category bar chart */}
          <ChartCard title="Doanh thu theo danh mục" subtitle="Tháng hiện tại">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={revenueByCategory} layout="vertical">
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
                  fill="#2563eb"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Top 10 products table */}
        <ChartCard title="Top 10 sản phẩm bán chạy" subtitle="Theo doanh thu tháng này">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4 font-medium w-8">#</th>
                  <th className="pb-2 pr-4 font-medium">Sản phẩm</th>
                  <th className="pb-2 pr-4 font-medium text-right">SL bán</th>
                  <th className="pb-2 font-medium text-right">Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-400 text-xs">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium text-gray-800">{p.name}</td>
                    <td className="py-2 pr-4 text-right text-gray-600">{p.qty}</td>
                    <td className="py-2 text-right font-semibold text-blue-700">
                      {formatCurrency(p.revenue)}đ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
