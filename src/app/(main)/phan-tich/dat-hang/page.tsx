"use client";

import {
  ClipboardList,
  CheckCircle,
  Truck,
  XCircle,
} from "lucide-react";
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
import { formatCurrency } from "@/lib/format";

// === KPI Data ===
const kpiCards = [
  {
    label: "Tổng đơn hàng",
    value: "1.247",
    change: "+15,3% so với tháng trước",
    positive: true,
    icon: ClipboardList,
    bg: "bg-blue-50",
    iconColor: "text-blue-600",
    valueColor: "text-blue-700",
  },
  {
    label: "Đơn hoàn thành",
    value: "1.089",
    change: "87,3% tổng đơn",
    positive: true,
    icon: CheckCircle,
    bg: "bg-green-50",
    iconColor: "text-green-600",
    valueColor: "text-green-700",
  },
  {
    label: "Đơn đang giao",
    value: "98",
    change: "7,9% tổng đơn",
    positive: true,
    icon: Truck,
    bg: "bg-orange-50",
    iconColor: "text-orange-600",
    valueColor: "text-orange-700",
  },
  {
    label: "Đơn hủy",
    value: "60",
    change: "4,8% tổng đơn",
    positive: false,
    icon: XCircle,
    bg: "bg-red-50",
    iconColor: "text-red-500",
    valueColor: "text-red-600",
  },
];

// === 30-day order volume ===
const orderVolume = Array.from({ length: 30 }, (_, i) => {
  const d = i + 1;
  const base = 38;
  const dayOfWeek = (d + 2) % 7;
  const weekendBoost = dayOfWeek >= 5 ? 12 : 0;
  const noise = Math.round(Math.sin(d * 1.5) * 8 + Math.cos(d * 0.9) * 5);
  return {
    day: `${d.toString().padStart(2, "0")}/03`,
    orders: Math.max(base + weekendBoost + noise + Math.round(d * 0.3), 20),
  };
});

// === Order status distribution ===
const orderStatus = [
  { name: "Hoàn thành", value: 1089 },
  { name: "Đang xử lý", value: 78 },
  { name: "Đang giao", value: 98 },
  { name: "Đã hủy", value: 60 },
];

const STATUS_COLORS = ["#16a34a", "#eab308", "#f97316", "#ef4444"];

// === Average processing time by day of week ===
const processingTime = [
  { day: "T2", minutes: 42 },
  { day: "T3", minutes: 38 },
  { day: "T4", minutes: 35 },
  { day: "T5", minutes: 40 },
  { day: "T6", minutes: 45 },
  { day: "T7", minutes: 52 },
  { day: "CN", minutes: 55 },
];

// === Recent orders ===
const recentOrders = [
  { id: "DH-2603001", customer: "Chuỗi The Coffee House", status: "Hoàn thành", value: 18500000, date: "26/03/2026" },
  { id: "DH-2603002", customer: "Công ty PP Miền Nam", status: "Đang giao", value: 32000000, date: "26/03/2026" },
  { id: "DH-2503003", customer: "Quán Bùi Thanh Tâm", status: "Hoàn thành", value: 5200000, date: "25/03/2026" },
  { id: "DH-2503004", customer: "Nguyễn Minh Tuấn", status: "Đang xử lý", value: 1850000, date: "25/03/2026" },
  { id: "DH-2503005", customer: "Công ty TNHH ABC Coffee", status: "Hoàn thành", value: 12800000, date: "25/03/2026" },
  { id: "DH-2403006", customer: "Lê Văn Đức", status: "Đã hủy", value: 3500000, date: "24/03/2026" },
  { id: "DH-2403007", customer: "Đỗ Quang Huy", status: "Hoàn thành", value: 8900000, date: "24/03/2026" },
  { id: "DH-2403008", customer: "Hoàng Anh Dũng", status: "Đang giao", value: 6300000, date: "24/03/2026" },
  { id: "DH-2303009", customer: "Trần Thị Hoa", status: "Hoàn thành", value: 2100000, date: "23/03/2026" },
  { id: "DH-2303010", customer: "Phạm Ngọc Anh", status: "Hoàn thành", value: 4750000, date: "23/03/2026" },
];

const STATUS_BADGE: Record<string, string> = {
  "Hoàn thành": "bg-green-100 text-green-700",
  "Đang xử lý": "bg-yellow-100 text-yellow-700",
  "Đang giao": "bg-orange-100 text-orange-700",
  "Đã hủy": "bg-red-100 text-red-600",
};

// === Tooltips ===
function OrderVolumeTooltip({
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
        {payload[0].value} đơn hàng
      </p>
    </div>
  );
}

function StatusPieTooltip({
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
      <p className="text-sm font-bold">{payload[0].value} đơn</p>
    </div>
  );
}

function ProcessingTimeTooltip({
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
        {payload[0].value} phút
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

export default function DatHangPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích đặt hàng"
        subtitle="Theo dõi tình trạng và hiệu suất đơn hàng"
      />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>

        {/* Order volume line chart */}
        <ChartCard
          title="Số lượng đơn hàng theo ngày"
          subtitle="30 ngày gần nhất - Tháng 03/2026"
        >
          <div className="h-48 md:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={orderVolume}
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
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                />
                <Tooltip content={<OrderVolumeTooltip />} />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, fill: "#2563eb" }}
                  name="Đơn hàng"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Order status pie chart */}
          <ChartCard
            title="Phân bổ trạng thái đơn hàng"
            subtitle="Tháng 03/2026"
          >
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={orderStatus}
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
                    {orderStatus.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={STATUS_COLORS[index % STATUS_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<StatusPieTooltip />} />
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

          {/* Processing time bar chart */}
          <ChartCard
            title="Thời gian xử lý đơn trung bình"
            subtitle="Theo ngày trong tuần (phút)"
          >
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={processingTime}
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
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={35}
                    unit=" ph"
                  />
                  <Tooltip content={<ProcessingTimeTooltip />} />
                  <Bar
                    dataKey="minutes"
                    fill="#9333ea"
                    radius={[6, 6, 0, 0]}
                    name="Thời gian xử lý"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* Recent orders table */}
        <ChartCard title="Đơn hàng gần đây" subtitle="10 đơn mới nhất">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Mã ĐH</th>
                  <th className="text-left py-2 pr-4 font-medium">
                    Khách hàng
                  </th>
                  <th className="text-left py-2 pr-4 font-medium">
                    Trạng thái
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">Giá trị</th>
                  <th className="text-right py-2 font-medium">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs font-medium text-primary">
                      {order.id}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{order.customer}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[order.status] ?? ""}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-medium">
                      {formatCurrency(order.value)}
                    </td>
                    <td className="py-2.5 text-right text-muted-foreground text-xs">
                      {order.date}
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
