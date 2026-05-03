"use client";

/**
 * Dashboard charts — tách thành lazy chunk để Recharts (~150KB gz + d3 deps)
 * KHÔNG bundle vào initial JS của route `/`.
 *
 * PERF F4: Trước đây import top-level recharts ở `(main)/page.tsx` → mọi
 * user vào trang chủ phải tải nguyên bộ charting trước khi LCP. Bằng dynamic
 * import + Suspense, charts chỉ tải khi React hydrate xong + element scroll
 * vào view (Suspense fallback hiện skeleton).
 */

import {
  AreaChart,
  Area,
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";

export type ChartView = "day" | "hour" | "weekday";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface OrderChartPoint {
  day: string;
  completed: number;
  cancelled: number;
}

interface DashboardChartsProps {
  chartData: Record<ChartView, ChartPoint[]>;
  chartView: ChartView;
  setChartView: (v: ChartView) => void;
  orders: OrderChartPoint[];
}

const VIEW_OPTIONS: { value: ChartView; label: string }[] = [
  { value: "day", label: "Ngày" },
  { value: "hour", label: "Giờ" },
  { value: "weekday", label: "Tuần" },
];

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
    <div className="rounded-xl border bg-surface-container-lowest p-3 ambient-shadow">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-bold text-primary">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function OrdersTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-surface-container-lowest p-3 ambient-shadow">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
          {entry.dataKey === "completed" ? "Hoàn thành" : "Đã hủy"}:{" "}
          <span className="font-bold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function DashboardCharts({
  chartData,
  chartView,
  setChartView,
  orders,
}: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Revenue AreaChart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Doanh thu</CardTitle>
            <div className="flex gap-1">
              {VIEW_OPTIONS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setChartView(v.value)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                    chartView === v.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-container-low hover:bg-surface-container",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData[chartView]}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#004AC6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#004AC6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
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
                <Tooltip content={<RevenueTooltip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#004AC6"
                  strokeWidth={2}
                  fill="url(#revenueGradient)"
                  name="Doanh thu"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Orders BarChart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Đơn hàng theo trạng thái</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={orders}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                />
                <Tooltip content={<OrdersTooltip />} />
                <Legend
                  formatter={(value: string) =>
                    value === "completed" ? "Hoàn thành" : "Đã hủy"
                  }
                />
                <Bar
                  dataKey="completed"
                  fill="#22c55e"
                  radius={[6, 6, 0, 0]}
                  name="completed"
                />
                <Bar
                  dataKey="cancelled"
                  fill="#ef4444"
                  radius={[6, 6, 0, 0]}
                  name="cancelled"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
