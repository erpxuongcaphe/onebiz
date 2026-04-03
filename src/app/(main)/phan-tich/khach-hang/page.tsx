"use client";

import { Users, UserPlus, RefreshCw, CreditCard } from "lucide-react";
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
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";

// === Mock Data ===

const newCustomersMonthly = [
  { month: "T10/2025", count: 14 },
  { month: "T11/2025", count: 21 },
  { month: "T12/2025", count: 18 },
  { month: "T01/2026", count: 25 },
  { month: "T02/2026", count: 20 },
  { month: "T03/2026", count: 28 },
];

const customerSegments = [
  { name: "VIP", value: 18 },
  { name: "Thân thiết", value: 45 },
  { name: "Thường", value: 120 },
  { name: "Mới", value: 63 },
];

const SEGMENT_COLORS = ["#f59e0b", "#2563eb", "#16a34a", "#8b5cf6"];

const topCustomers = [
  { rank: 1, name: "Công ty Phân Phối Miền Nam", orders: 95, revenue: 520000000 },
  { rank: 2, name: "Chuỗi The Coffee House clone", orders: 128, revenue: 385000000 },
  { rank: 3, name: "Công ty TNHH ABC Coffee", orders: 67, revenue: 142000000 },
  { rank: 4, name: "Quán Cà Phê Bùi Thanh Tâm", orders: 54, revenue: 98000000 },
  { rank: 5, name: "Trần Minh Đạt - Đại lý Q.7", orders: 42, revenue: 76000000 },
  { rank: 6, name: "Lê Văn Đức", orders: 32, revenue: 45000000 },
  { rank: 7, name: "Đỗ Quang Huy", orders: 28, revenue: 32500000 },
  { rank: 8, name: "Nguyễn Minh Tuấn", orders: 24, revenue: 27000000 },
  { rank: 9, name: "Hoàng Anh Dũng", orders: 19, revenue: 18500000 },
  { rank: 10, name: "Phạm Ngọc Anh", orders: 12, revenue: 12700000 },
];

const topDebtors = [
  { name: "CT Phân Phối Miền Nam", fullName: "Công ty Phân Phối Miền Nam", debt: 185000000 },
  { name: "CT TNHH ABC Coffee", fullName: "Công ty TNHH ABC Coffee", debt: 92000000 },
  { name: "Trần Minh Đạt - ĐL Q.7", fullName: "Trần Minh Đạt - Đại lý Q.7", debt: 54000000 },
  { name: "Quán CF Bùi Thanh Tâm", fullName: "Quán Cà Phê Bùi Thanh Tâm", debt: 38000000 },
  { name: "Lê Văn Đức", fullName: "Lê Văn Đức", debt: 21000000 },
];

// === Custom Tooltips ===

function NewCustomerTooltip({
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
      <p className="text-sm font-bold text-blue-600">
        {payload[0].value} khách mới
      </p>
    </div>
  );
}

function SegmentTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{payload[0].name}</p>
      <p className="text-sm font-bold">{payload[0].value} khách hàng</p>
    </div>
  );
}

function DebtTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { fullName: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">
        {payload[0].payload.fullName}
      </p>
      <p className="text-sm font-bold text-red-600">
        Nợ: {formatChartTooltipCurrency(payload[0].value)}
      </p>
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
  if (percent < 0.08) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function KhachHangPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích khách hàng"
        subtitle="Thống kê và phân loại khách hàng"
      />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng khách hàng"
            value="246"
            change="+12 so với tháng trước"
            positive
            icon={Users}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Khách mới tháng"
            value="28"
            change="+40% so với tháng trước"
            positive
            icon={UserPlus}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Khách quay lại"
            value="67%"
            change="+5% so với tháng trước"
            positive
            icon={RefreshCw}
            bg="bg-purple-50"
            iconColor="text-purple-600"
            valueColor="text-purple-700"
          />
          <KpiCard
            label="Nợ phải thu"
            value={formatCurrency(390000000)}
            change="+8.2% so với tháng trước"
            positive={false}
            icon={CreditCard}
            bg="bg-red-50"
            iconColor="text-red-600"
            valueColor="text-red-700"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* New customers per month */}
          <ChartCard title="Khách hàng mới theo tháng" subtitle="6 tháng gần nhất">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={newCustomersMonthly}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip content={<NewCustomerTooltip />} />
                  <Bar
                    dataKey="count"
                    fill="#2563eb"
                    radius={[6, 6, 0, 0]}
                    name="Khách mới"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Customer segments */}
          <ChartCard title="Phân loại khách hàng" subtitle="Theo nhóm khách hàng">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={customerSegments}
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
                    {customerSegments.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={SEGMENT_COLORS[index % SEGMENT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<SegmentTooltip />} />
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
        </div>

        {/* Top 10 customers table */}
        <ChartCard title="Top 10 khách hàng theo doanh thu">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">#</th>
                  <th className="text-left py-2 pr-4 font-medium">Khách hàng</th>
                  <th className="text-right py-2 pr-4 font-medium">Số đơn</th>
                  <th className="text-right py-2 font-medium">Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((item) => (
                  <tr key={item.rank} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 text-muted-foreground">{item.rank}</td>
                    <td className="py-2.5 pr-4 font-medium">{item.name}</td>
                    <td className="py-2.5 pr-4 text-right">{item.orders}</td>
                    <td className="py-2.5 text-right font-medium text-primary">
                      {formatCurrency(item.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        {/* Customer debt ranking */}
        <ChartCard title="Xếp hạng công nợ khách hàng" subtitle="Top 5 khách hàng có công nợ cao nhất">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...topDebtors].reverse()}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => formatChartCurrency(v)}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={150}
                />
                <Tooltip content={<DebtTooltip />} />
                <Bar
                  dataKey="debt"
                  fill="#ef4444"
                  radius={[0, 6, 6, 0]}
                  name="Công nợ"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
