"use client";

import { TrendingUp, TrendingDown, DollarSign, Percent } from "lucide-react";
import {
  LineChart,
  Line,
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

const revenueVsExpense = [
  { month: "T04/25", revenue: 380000000, expense: 285000000 },
  { month: "T05/25", revenue: 420000000, expense: 310000000 },
  { month: "T06/25", revenue: 395000000, expense: 298000000 },
  { month: "T07/25", revenue: 450000000, expense: 325000000 },
  { month: "T08/25", revenue: 410000000, expense: 305000000 },
  { month: "T09/25", revenue: 465000000, expense: 340000000 },
  { month: "T10/25", revenue: 490000000, expense: 355000000 },
  { month: "T11/25", revenue: 520000000, expense: 368000000 },
  { month: "T12/25", revenue: 580000000, expense: 420000000 },
  { month: "T01/26", revenue: 510000000, expense: 380000000 },
  { month: "T02/26", revenue: 475000000, expense: 350000000 },
  { month: "T03/26", revenue: 545000000, expense: 390000000 },
];

const expenseBreakdown = [
  { name: "Nhập hàng", value: 245000000 },
  { name: "Lương", value: 68000000 },
  { name: "Mặt bằng", value: 35000000 },
  { name: "Vận chuyển", value: 28000000 },
  { name: "Khác", value: 14000000 },
];

const EXPENSE_COLORS = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#6b7280"];

const monthlyProfit = [
  { month: "T04/25", profit: 95000000 },
  { month: "T05/25", profit: 110000000 },
  { month: "T06/25", profit: 97000000 },
  { month: "T07/25", profit: 125000000 },
  { month: "T08/25", profit: 105000000 },
  { month: "T09/25", profit: 125000000 },
  { month: "T10/25", profit: 135000000 },
  { month: "T11/25", profit: 152000000 },
  { month: "T12/25", profit: 160000000 },
  { month: "T01/26", profit: 130000000 },
  { month: "T02/26", profit: 125000000 },
  { month: "T03/26", profit: 155000000 },
];

const cashFlowData = [
  { month: "T10/2025", thu: 490000000, chi: 355000000, ton: 285000000 },
  { month: "T11/2025", thu: 520000000, chi: 368000000, ton: 437000000 },
  { month: "T12/2025", thu: 580000000, chi: 420000000, ton: 597000000 },
  { month: "T01/2026", thu: 510000000, chi: 380000000, ton: 727000000 },
  { month: "T02/2026", thu: 475000000, chi: 350000000, ton: 852000000 },
  { month: "T03/2026", thu: 545000000, chi: 390000000, ton: 1007000000 },
];

// === Custom Tooltips ===

function RevenueExpenseTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm font-bold" style={{ color: p.color }}>
          {p.name}: {formatChartTooltipCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

function ExpenseTooltip({
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
      <p className="text-sm font-bold">{formatChartTooltipCurrency(payload[0].value)}</p>
    </div>
  );
}

function ProfitTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm font-bold ${value >= 0 ? "text-green-600" : "text-red-600"}`}>
        {value >= 0 ? "+" : ""}{formatChartTooltipCurrency(value)}
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
  if (percent < 0.05) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function TaiChinhPage() {
  const totalRevenue = 545000000;
  const totalExpense = 390000000;
  const profit = totalRevenue - totalExpense;
  const profitMargin = ((profit / totalRevenue) * 100).toFixed(1);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích tài chính"
        subtitle="Tổng quan doanh thu, chi phí và lợi nhuận"
      />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={formatCurrency(totalRevenue)}
            change="+14.7% so với tháng trước"
            positive
            icon={TrendingUp}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Chi phí"
            value={formatCurrency(totalExpense)}
            change="+11.4% so với tháng trước"
            positive={false}
            icon={TrendingDown}
            bg="bg-red-50"
            iconColor="text-red-600"
            valueColor="text-red-700"
          />
          <KpiCard
            label="Lợi nhuận"
            value={formatCurrency(profit)}
            change="+24% so với tháng trước"
            positive
            icon={DollarSign}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Tỷ suất LN"
            value={`${profitMargin}%`}
            change="+2.1% so với tháng trước"
            positive
            icon={Percent}
            bg="bg-purple-50"
            iconColor="text-purple-600"
            valueColor="text-purple-700"
          />
        </div>

        {/* Revenue vs Expense line chart */}
        <ChartCard title="Doanh thu và Chi phí" subtitle="12 tháng gần nhất">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={revenueVsExpense}
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
                  tickFormatter={(v: number) => formatChartCurrency(v)}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip content={<RevenueExpenseTooltip />} />
                <Legend
                  verticalAlign="top"
                  formatter={(value: string) => (
                    <span className="text-xs">{value}</span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ fill: "#2563eb", r: 3 }}
                  activeDot={{ r: 5, fill: "#2563eb" }}
                  name="Doanh thu"
                />
                <Line
                  type="monotone"
                  dataKey="expense"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ fill: "#ef4444", r: 3 }}
                  activeDot={{ r: 5, fill: "#ef4444" }}
                  name="Chi phí"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Expense breakdown pie chart */}
          <ChartCard title="Cơ cấu chi phí" subtitle="Tháng 03/2026">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expenseBreakdown}
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
                    {expenseBreakdown.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<ExpenseTooltip />} />
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

          {/* Monthly profit bar chart */}
          <ChartCard title="Lợi nhuận theo tháng" subtitle="12 tháng gần nhất">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyProfit}
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
                    tickFormatter={(v: number) => formatChartCurrency(v)}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip content={<ProfitTooltip />} />
                  <Bar
                    dataKey="profit"
                    radius={[6, 6, 0, 0]}
                    name="Lợi nhuận"
                  >
                    {monthlyProfit.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.profit >= 0 ? "#16a34a" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* Cash flow summary table */}
        <ChartCard title="Tổng hợp dòng tiền" subtitle="6 tháng gần nhất">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Tháng</th>
                  <th className="text-right py-2 pr-4 font-medium">Thu</th>
                  <th className="text-right py-2 pr-4 font-medium">Chi</th>
                  <th className="text-right py-2 font-medium">Tồn quỹ</th>
                </tr>
              </thead>
              <tbody>
                {cashFlowData.map((item) => (
                  <tr key={item.month} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{item.month}</td>
                    <td className="py-2.5 pr-4 text-right text-green-600 font-medium">
                      +{formatCurrency(item.thu)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-red-600 font-medium">
                      -{formatCurrency(item.chi)}
                    </td>
                    <td className="py-2.5 text-right font-bold text-primary">
                      {formatCurrency(item.ton)}
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
