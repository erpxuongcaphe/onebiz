"use client";

import { TrendingUp, Package, Receipt, RotateCcw } from "lucide-react";
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
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";

// === Mock Data ===

// 30-day daily revenue
const dailyRevenue = Array.from({ length: 30 }, (_, i) => {
  const d = i + 1;
  const base = 32_000_000;
  const dayOfWeek = (d + 2) % 7;
  const weekendBoost = dayOfWeek >= 5 ? 12_000_000 : 0;
  const noise = Math.round(
    Math.sin(d * 1.2) * 7_000_000 + Math.cos(d * 0.8) * 4_000_000
  );
  const revenue = base + weekendBoost + noise + d * 150_000;
  return {
    day: `${d.toString().padStart(2, "0")}/03`,
    revenue: Math.max(revenue, 18_000_000),
  };
});

// Revenue by day of week
const revenueByDayOfWeek = [
  { day: "Thứ 2", revenue: 28_500_000 },
  { day: "Thứ 3", revenue: 31_200_000 },
  { day: "Thứ 4", revenue: 29_800_000 },
  { day: "Thứ 5", revenue: 33_100_000 },
  { day: "Thứ 6", revenue: 38_500_000 },
  { day: "Thứ 7", revenue: 45_200_000 },
  { day: "CN", revenue: 42_800_000 },
];

const DAY_COLORS = [
  "#64748b",
  "#64748b",
  "#64748b",
  "#64748b",
  "#3b82f6",
  "#16a34a",
  "#16a34a",
];

// Revenue by hour (0-23h)
const revenueByHour = Array.from({ length: 24 }, (_, h) => {
  let base = 500_000;
  if (h >= 7 && h <= 11)
    base =
      3_500_000 + (h === 9 ? 1_800_000 : 0) + (h === 10 ? 1_200_000 : 0);
  if (h >= 12 && h <= 13) base = 2_200_000;
  if (h >= 14 && h <= 17)
    base =
      3_000_000 + (h === 15 ? 1_500_000 : 0) + (h === 16 ? 1_000_000 : 0);
  if (h >= 18 && h <= 20) base = 1_800_000;
  if (h >= 21 && h <= 22) base = 800_000;
  if (h >= 0 && h <= 5) base = 200_000 + h * 50_000;
  if (h === 6) base = 1_200_000;

  const noise = Math.round(Math.sin(h * 2.1) * 300_000);
  return {
    hour: `${h.toString().padStart(2, "0")}h`,
    revenue: Math.max(base + noise, 100_000),
  };
});

// Top 10 invoices
const topInvoices = [
  { code: "HD-03-0847", customer: "Chuỗi Highland Coffee", value: 18_500_000, date: "28/03/2026" },
  { code: "HD-03-0812", customer: "Công ty TNHH Phân Phối Miền Nam", value: 15_200_000, date: "25/03/2026" },
  { code: "HD-03-0791", customer: "Quán The Mỏi Coffee", value: 12_800_000, date: "22/03/2026" },
  { code: "HD-03-0835", customer: "Siêu thị WinMart Tân Bình", value: 11_400_000, date: "27/03/2026" },
  { code: "HD-03-0768", customer: "Công ty CP Đại Phát", value: 9_800_000, date: "20/03/2026" },
  { code: "HD-03-0801", customer: "Nguyễn Văn Tùng (Sỉ)", value: 8_500_000, date: "23/03/2026" },
  { code: "HD-03-0756", customer: "Quán Cà Phê Sài Gòn Xưa", value: 7_200_000, date: "18/03/2026" },
  { code: "HD-03-0823", customer: "Trần Thị Mai - Đại lý Q7", value: 6_900_000, date: "26/03/2026" },
  { code: "HD-03-0744", customer: "Lê Hoàng Phúc", value: 6_500_000, date: "16/03/2026" },
  { code: "HD-03-0839", customer: "Công ty TNHH Hương Việt", value: 6_200_000, date: "27/03/2026" },
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
      <p className="text-sm font-bold text-blue-600">
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
      <p className="text-sm font-bold text-green-600">
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
      <p className="text-sm font-bold text-purple-600">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

// === Page ===

export default function BanHangPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích bán hàng"
        subtitle="Thống kê doanh thu và đơn hàng theo thời gian"
      />

      <div className="flex-1 p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu thuần"
            value={formatCurrency(856_200_000) + "đ"}
            change="+15,3% so với tháng trước"
            positive
            icon={TrendingUp}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Số lượng bán"
            value="2.847"
            change="+234 sản phẩm"
            positive
            icon={Package}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Giá trị trung bình/đơn"
            value={formatCurrency(1_250_000) + "đ"}
            change="+3,2% so với tháng trước"
            positive
            icon={Receipt}
            bg="bg-purple-50"
            iconColor="text-purple-600"
            valueColor="text-purple-700"
          />
          <KpiCard
            label="Tỷ lệ trả hàng"
            value="1,8%"
            change="-0,3% so với tháng trước"
            positive
            icon={RotateCcw}
            bg="bg-orange-50"
            iconColor="text-orange-600"
            valueColor="text-orange-700"
          />
        </div>

        {/* Daily Revenue Trend */}
        <ChartCard
          title="Xu hướng doanh thu 30 ngày"
          subtitle="Tháng 03/2026"
        >
          <div className="h-56 md:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dailyRevenue}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
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
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, fill: "#2563eb" }}
                  name="Doanh thu"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue by Day of Week */}
          <ChartCard
            title="Doanh thu theo thứ trong tuần"
            subtitle="Trung bình tháng 03/2026"
          >
            <div className="h-56 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={revenueByDayOfWeek}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
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
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]} name="Doanh thu">
                    {revenueByDayOfWeek.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={DAY_COLORS[index]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Revenue by Hour */}
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
                    dataKey="hour"
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
                    dataKey="revenue"
                    stroke="#9333ea"
                    strokeWidth={2}
                    fill="url(#colorRevHour)"
                    name="Doanh thu"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* Top 10 Invoices Table */}
        <ChartCard
          title="Top 10 hóa đơn giá trị cao nhất"
          subtitle="Tháng 03/2026"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Mã HĐ</th>
                  <th className="text-left py-2 pr-4 font-medium">
                    Khách hàng
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">Giá trị</th>
                  <th className="text-right py-2 font-medium">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {topInvoices.map((inv) => (
                  <tr key={inv.code} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs text-blue-600">
                      {inv.code}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{inv.customer}</td>
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
      </div>
    </div>
  );
}
