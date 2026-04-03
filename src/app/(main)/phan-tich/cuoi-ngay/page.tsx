"use client";

import {
  DollarSign,
  ShoppingCart,
  Banknote,
  CreditCard,
  Landmark,
  RotateCcw,
} from "lucide-react";
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

// === Mock: Doanh thu theo giờ ===
const revenueByHour = Array.from({ length: 24 }, (_, h) => {
  let base = 0;
  if (h >= 7 && h <= 9) base = 3_500_000 + Math.random() * 1_500_000; // sáng sớm
  else if (h >= 10 && h <= 12) base = 4_000_000 + Math.random() * 2_000_000; // trưa
  else if (h >= 13 && h <= 15) base = 2_500_000 + Math.random() * 1_000_000; // chiều
  else if (h >= 16 && h <= 19) base = 3_800_000 + Math.random() * 1_500_000; // chiều tối
  else if (h >= 20 && h <= 22) base = 2_000_000 + Math.random() * 800_000; // tối
  else base = 200_000 + Math.random() * 300_000; // khuya/sáng sớm
  return {
    hour: `${String(h).padStart(2, "0")}:00`,
    revenue: Math.round(base),
  };
});

const totalRevenue = revenueByHour.reduce((s, h) => s + h.revenue, 0);

// === Mock: Phương thức thanh toán ===
const cashAmount = Math.round(totalRevenue * 0.65);
const transferAmount = Math.round(totalRevenue * 0.25);
const cardAmount = totalRevenue - cashAmount - transferAmount;

const paymentMethods = [
  { name: "Tiền mặt", value: cashAmount, color: "#22c55e" },
  { name: "Chuyển khoản", value: transferAmount, color: "#3b82f6" },
  { name: "Thẻ", value: cardAmount, color: "#f59e0b" },
];

// === Mock: Top 5 sản phẩm hôm nay ===
const topProducts = [
  { name: "Cà phê Robusta Đắk Lắk 500g", qty: 28 },
  { name: "Cà phê sữa hoà tan 3in1", qty: 24 },
  { name: "Cà phê Arabica Cầu Đất 250g", qty: 19 },
  { name: "Trà ô long Bảo Lộc 200g", qty: 15 },
  { name: "Cà phê Cold Brew chai 500ml", qty: 12 },
];

const returnAmount = Math.round(totalRevenue * 0.02);
const totalOrders = 47;

// === Custom tooltips ===
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
  return (
    <div className="bg-white border rounded-lg shadow-lg p-2.5 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{d.name}</p>
      <p style={{ color: d.payload.color }}>
        {formatChartTooltipCurrency(d.value)} ({((d.value / totalRevenue) * 100).toFixed(1)}%)
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

export default function CuoiNgayPage() {
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
            change="+5,2% so với hôm qua"
            positive
            icon={DollarSign}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Tổng đơn hàng"
            value={String(totalOrders)}
            change="+3 đơn so với hôm qua"
            positive
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
            change="2 đơn trả hàng"
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
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={revenueByHour}>
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
          </ChartCard>

          {/* Payment method pie */}
          <ChartCard title="Phương thức thanh toán" subtitle="Tỷ lệ theo giá trị">
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
                        {((m.value / totalRevenue) * 100).toFixed(1)}%
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
                      {((returnAmount / totalRevenue) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr className="border-t-2 font-bold text-emerald-700">
                    <td className="py-2.5 pr-4">Doanh thu thực</td>
                    <td className="py-2.5 pr-4 text-right">
                      {formatCurrency(totalRevenue - returnAmount)}đ
                    </td>
                    <td className="py-2.5 text-right">
                      {(((totalRevenue - returnAmount) / totalRevenue) * 100).toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* Top 5 products horizontal bar */}
          <ChartCard title="Top 5 sản phẩm bán chạy hôm nay" subtitle="Theo số lượng bán">
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
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
