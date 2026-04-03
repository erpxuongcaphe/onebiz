"use client";

import {
  ShoppingCart,
  Globe,
  MessageCircle,
  Monitor,
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
  AreaChart,
  Area,
} from "recharts";
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";

// === KPI Cards ===
const kpiCards = [
  {
    label: "Tại quầy",
    value: formatCurrency(485000000),
    change: "+8,2% so với tháng trước",
    positive: true,
    icon: ShoppingCart,
    bg: "bg-blue-50",
    iconColor: "text-blue-600",
    valueColor: "text-blue-700",
  },
  {
    label: "Facebook",
    value: formatCurrency(162000000),
    change: "+22,5% so với tháng trước",
    positive: true,
    icon: Globe,
    bg: "bg-indigo-50",
    iconColor: "text-indigo-600",
    valueColor: "text-indigo-700",
  },
  {
    label: "Zalo",
    value: formatCurrency(97000000),
    change: "+18,1% so với tháng trước",
    positive: true,
    icon: MessageCircle,
    bg: "bg-sky-50",
    iconColor: "text-sky-600",
    valueColor: "text-sky-700",
  },
  {
    label: "Website",
    value: formatCurrency(64500000),
    change: "+35,7% so với tháng trước",
    positive: true,
    icon: Monitor,
    bg: "bg-purple-50",
    iconColor: "text-purple-600",
    valueColor: "text-purple-700",
  },
];

// === Revenue by channel pie chart ===
const revenueByChannel = [
  { name: "Tại quầy", value: 485000000 },
  { name: "Facebook", value: 162000000 },
  { name: "Zalo", value: 97000000 },
  { name: "Website", value: 64500000 },
];

const CHANNEL_COLORS = ["#2563eb", "#6366f1", "#0ea5e9", "#9333ea"];

// === Channel revenue trend (12 months, stacked area) ===
const channelTrend = [
  { month: "T04/25", taiQuay: 380000000, facebook: 98000000, zalo: 52000000, website: 28000000 },
  { month: "T05/25", taiQuay: 395000000, facebook: 105000000, zalo: 58000000, website: 32000000 },
  { month: "T06/25", taiQuay: 410000000, facebook: 112000000, zalo: 62000000, website: 35000000 },
  { month: "T07/25", taiQuay: 388000000, facebook: 118000000, zalo: 65000000, website: 38000000 },
  { month: "T08/25", taiQuay: 420000000, facebook: 125000000, zalo: 70000000, website: 40000000 },
  { month: "T09/25", taiQuay: 435000000, facebook: 130000000, zalo: 72000000, website: 42000000 },
  { month: "T10/25", taiQuay: 445000000, facebook: 135000000, zalo: 78000000, website: 45000000 },
  { month: "T11/25", taiQuay: 458000000, facebook: 140000000, zalo: 82000000, website: 48000000 },
  { month: "T12/25", taiQuay: 520000000, facebook: 155000000, zalo: 90000000, website: 55000000 },
  { month: "T01/26", taiQuay: 465000000, facebook: 148000000, zalo: 85000000, website: 52000000 },
  { month: "T02/26", taiQuay: 448000000, facebook: 132000000, zalo: 82000000, website: 47000000 },
  { month: "T03/26", taiQuay: 485000000, facebook: 162000000, zalo: 97000000, website: 64500000 },
];

// === Orders by channel (grouped bar) ===
const ordersByChannel = [
  { month: "T10/25", taiQuay: 520, facebook: 185, zalo: 112, website: 68 },
  { month: "T11/25", taiQuay: 535, facebook: 192, zalo: 120, website: 75 },
  { month: "T12/25", taiQuay: 610, facebook: 215, zalo: 135, website: 88 },
  { month: "T01/26", taiQuay: 548, facebook: 205, zalo: 128, website: 82 },
  { month: "T02/26", taiQuay: 510, facebook: 178, zalo: 115, website: 72 },
  { month: "T03/26", taiQuay: 565, facebook: 220, zalo: 142, website: 95 },
];

// === Channel performance table ===
const channelPerformance = [
  { channel: "Tại quầy", revenue: 485000000, orders: 565, avgValue: 858407 },
  { channel: "Facebook", revenue: 162000000, orders: 220, avgValue: 736364 },
  { channel: "Zalo", revenue: 97000000, orders: 142, avgValue: 683099 },
  { channel: "Website", revenue: 64500000, orders: 95, avgValue: 678947 },
];

// === Tooltips ===
function ChannelPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  const total = revenueByChannel.reduce((s, c) => s + c.value, 0);
  const pct = ((payload[0].value / total) * 100).toFixed(1);
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{payload[0].name}</p>
      <p className="text-sm font-bold">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
      <p className="text-xs text-muted-foreground">{pct}% tổng doanh thu</p>
    </div>
  );
}

function ChannelTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const nameMap: Record<string, string> = {
    taiQuay: "Tại quầy",
    facebook: "Facebook",
    zalo: "Zalo",
    website: "Website",
  };
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs mb-1">
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">
            {nameMap[entry.name] ?? entry.name}:
          </span>
          <span className="font-semibold ml-auto">
            {formatChartTooltipCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function OrdersByChannelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const nameMap: Record<string, string> = {
    taiQuay: "Tại quầy",
    facebook: "Facebook",
    zalo: "Zalo",
    website: "Website",
  };
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs mb-1">
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">
            {nameMap[entry.name] ?? entry.name}:
          </span>
          <span className="font-semibold ml-auto">{entry.value} đơn</span>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPieLabel(props: any) {
  const cx = props.cx as number;
  const cy = props.cy as number;
  const midAngle = (props.midAngle as number) ?? 0;
  const innerRadius = props.innerRadius as number;
  const outerRadius = props.outerRadius as number;
  const percent = (props.percent as number) ?? 0;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.06) return null;
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

const CHANNEL_NAME_MAP: Record<string, string> = {
  taiQuay: "Tại quầy",
  facebook: "Facebook",
  zalo: "Zalo",
  website: "Website",
};

export default function KenhBanPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích kênh bán"
        subtitle="So sánh hiệu suất các kênh bán hàng"
      />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue by channel pie chart */}
          <ChartCard
            title="Doanh thu theo kênh bán"
            subtitle="Tháng 03/2026"
          >
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={revenueByChannel}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderPieLabel}
                    outerRadius="80%"
                    dataKey="value"
                    nameKey="name"
                    strokeWidth={2}
                    stroke="#fff"
                  >
                    {revenueByChannel.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHANNEL_COLORS[index % CHANNEL_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<ChannelPieTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    formatter={(value: string) => (
                      <span className="text-xs">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Orders by channel grouped bar chart */}
          <ChartCard
            title="Số đơn hàng theo kênh"
            subtitle="6 tháng gần nhất"
          >
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ordersByChannel}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip content={<OrdersByChannelTooltip />} />
                  <Legend
                    verticalAlign="top"
                    formatter={(value: string) => (
                      <span className="text-xs">
                        {CHANNEL_NAME_MAP[value] ?? value}
                      </span>
                    )}
                  />
                  <Bar
                    dataKey="taiQuay"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                    name="taiQuay"
                  />
                  <Bar
                    dataKey="facebook"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                    name="facebook"
                  />
                  <Bar
                    dataKey="zalo"
                    fill="#0ea5e9"
                    radius={[4, 4, 0, 0]}
                    name="zalo"
                  />
                  <Bar
                    dataKey="website"
                    fill="#9333ea"
                    radius={[4, 4, 0, 0]}
                    name="website"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* Channel revenue trend stacked area chart */}
        <ChartCard
          title="Xu hướng doanh thu theo kênh"
          subtitle="12 tháng gần nhất"
        >
          <div className="h-48 md:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={channelTrend}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={1}
                />
                <YAxis
                  tickFormatter={(v: number) => formatChartCurrency(v)}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip content={<ChannelTrendTooltip />} />
                <Legend
                  verticalAlign="top"
                  formatter={(value: string) => (
                    <span className="text-xs">
                      {CHANNEL_NAME_MAP[value] ?? value}
                    </span>
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="taiQuay"
                  stackId="1"
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.6}
                  name="taiQuay"
                />
                <Area
                  type="monotone"
                  dataKey="facebook"
                  stackId="1"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.6}
                  name="facebook"
                />
                <Area
                  type="monotone"
                  dataKey="zalo"
                  stackId="1"
                  stroke="#0ea5e9"
                  fill="#0ea5e9"
                  fillOpacity={0.6}
                  name="zalo"
                />
                <Area
                  type="monotone"
                  dataKey="website"
                  stackId="1"
                  stroke="#9333ea"
                  fill="#9333ea"
                  fillOpacity={0.6}
                  name="website"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Channel performance table */}
        <ChartCard
          title="Hiệu suất theo kênh bán"
          subtitle="Tháng 03/2026"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Kênh</th>
                  <th className="text-right py-2 pr-4 font-medium">
                    Doanh thu
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">
                    Đơn hàng
                  </th>
                  <th className="text-right py-2 font-medium">Giá trị TB</th>
                </tr>
              </thead>
              <tbody>
                {channelPerformance.map((row) => (
                  <tr key={row.channel} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{row.channel}</td>
                    <td className="py-2.5 pr-4 text-right font-medium text-primary">
                      {formatCurrency(row.revenue)}
                    </td>
                    <td className="py-2.5 pr-4 text-right">{row.orders}</td>
                    <td className="py-2.5 text-right text-muted-foreground">
                      {formatCurrency(row.avgValue)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="py-2.5 pr-4">Tổng cộng</td>
                  <td className="py-2.5 pr-4 text-right text-primary">
                    {formatCurrency(
                      channelPerformance.reduce((s, r) => s + r.revenue, 0)
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    {channelPerformance.reduce((s, r) => s + r.orders, 0)}
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground">
                    {formatCurrency(
                      Math.round(
                        channelPerformance.reduce((s, r) => s + r.revenue, 0) /
                          channelPerformance.reduce((s, r) => s + r.orders, 0)
                      )
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
