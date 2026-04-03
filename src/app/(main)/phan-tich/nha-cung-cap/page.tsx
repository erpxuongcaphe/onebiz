"use client";

import { Truck, ShoppingBag, Wallet, RotateCcw } from "lucide-react";
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

const purchaseByMonth = [
  { month: "T10/2025", amount: 320000000 },
  { month: "T11/2025", amount: 285000000 },
  { month: "T12/2025", amount: 410000000 },
  { month: "T01/2026", amount: 365000000 },
  { month: "T02/2026", amount: 295000000 },
  { month: "T03/2026", amount: 445000000 },
];

const topSuppliers = [
  { name: "CT CP Cà Phê Dầu Nguồn", fullName: "Công ty CP Cà Phê Dầu Nguồn", amount: 680000000 },
  { name: "Nông trại Lâm Đồng", fullName: "Nông trại Cà Phê Lâm Đồng", amount: 520000000 },
  { name: "CT TNHH Bao Bì Xanh", fullName: "Công ty TNHH Bao Bì Xanh", amount: 185000000 },
  { name: "CT Vận Chuyển Nhanh", fullName: "Công ty Vận Chuyển Nhanh", amount: 145000000 },
  { name: "CT CP Trà Ô Long VN", fullName: "Công ty CP Trà Ô Long Việt Nam", amount: 98000000 },
];

const paymentStatus = [
  { name: "Đã thanh toán", value: 1250000000 },
  { name: "Còn nợ", value: 320000000 },
  { name: "Quá hạn", value: 85000000 },
];

const PAYMENT_COLORS = ["#16a34a", "#f59e0b", "#ef4444"];

const supplierTable = [
  { rank: 1, name: "Công ty CP Cà Phê Dầu Nguồn", total: 680000000, debt: 120000000, orders: 48 },
  { rank: 2, name: "Nông trại Cà Phê Lâm Đồng", total: 520000000, debt: 85000000, orders: 36 },
  { rank: 3, name: "Công ty TNHH Bao Bì Xanh", total: 185000000, debt: 42000000, orders: 24 },
  { rank: 4, name: "Công ty Vận Chuyển Nhanh", total: 145000000, debt: 38000000, orders: 52 },
  { rank: 5, name: "Công ty CP Trà Ô Long Việt Nam", total: 98000000, debt: 15000000, orders: 18 },
  { rank: 6, name: "Cơ sở Cacao Đắk Lắk", total: 76000000, debt: 20000000, orders: 12 },
  { rank: 7, name: "CT TNHH Vật Tư Pha Chế", total: 58000000, debt: 0, orders: 15 },
  { rank: 8, name: "Công ty In Ấn Phú Thọ", total: 42000000, debt: 0, orders: 8 },
];

// === Custom Tooltips ===

function PurchaseTooltip({
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
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function SupplierAmountTooltip({
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
      <p className="text-sm font-bold text-orange-600">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function PaymentTooltip({
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
      <p className="text-sm font-bold">
        {formatChartTooltipCurrency(payload[0].value)}
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

export default function NhaCungCapPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích nhà cung cấp"
        subtitle="Thống kê mua hàng và công nợ nhà cung cấp"
      />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng NCC"
            value="24"
            change="+2 nhà cung cấp mới"
            positive
            icon={Truck}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Tổng mua tháng"
            value={formatCurrency(445000000)}
            change="+50.8% so với tháng trước"
            positive
            icon={ShoppingBag}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Công nợ NCC"
            value={formatCurrency(320000000)}
            change="-12% so với tháng trước"
            positive
            icon={Wallet}
            bg="bg-orange-50"
            iconColor="text-orange-600"
            valueColor="text-orange-700"
          />
          <KpiCard
            label="Trả hàng NCC"
            value={formatCurrency(12500000)}
            change="3 phiếu trả hàng"
            positive={false}
            icon={RotateCcw}
            bg="bg-red-50"
            iconColor="text-red-600"
            valueColor="text-red-700"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Purchase volume by month */}
          <ChartCard title="Giá trị mua hàng theo tháng" subtitle="6 tháng gần nhất">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={purchaseByMonth}
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
                    tickFormatter={(v: number) => formatChartCurrency(v)}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip content={<PurchaseTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ fill: "#2563eb", r: 4 }}
                    activeDot={{ r: 6, fill: "#2563eb" }}
                    name="Giá trị mua"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Top 5 suppliers horizontal bar */}
          <ChartCard title="Top 5 nhà cung cấp" subtitle="Theo giá trị mua hàng">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...topSuppliers].reverse()}
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
                  <Tooltip content={<SupplierAmountTooltip />} />
                  <Bar
                    dataKey="amount"
                    fill="#ea580c"
                    radius={[0, 6, 6, 0]}
                    name="Giá trị mua"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* Payment status pie chart */}
        <ChartCard title="Tình trạng thanh toán NCC" subtitle="Tổng hợp công nợ">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentStatus}
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
                  {paymentStatus.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PAYMENT_COLORS[index % PAYMENT_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip content={<PaymentTooltip />} />
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

        {/* Supplier table */}
        <ChartCard title="Bảng tổng hợp nhà cung cấp">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">#</th>
                  <th className="text-left py-2 pr-4 font-medium">NCC</th>
                  <th className="text-right py-2 pr-4 font-medium">Tổng mua</th>
                  <th className="text-right py-2 pr-4 font-medium">Công nợ</th>
                  <th className="text-right py-2 font-medium">Số đơn</th>
                </tr>
              </thead>
              <tbody>
                {supplierTable.map((item) => (
                  <tr key={item.rank} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 text-muted-foreground">{item.rank}</td>
                    <td className="py-2.5 pr-4 font-medium">{item.name}</td>
                    <td className="py-2.5 pr-4 text-right font-medium text-primary">
                      {formatCurrency(item.total)}
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      {item.debt > 0 ? (
                        <span className="text-red-600 font-medium">{formatCurrency(item.debt)}</span>
                      ) : (
                        <span className="text-green-600">0</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">{item.orders}</td>
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
