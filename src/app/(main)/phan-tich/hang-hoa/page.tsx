"use client";

import { Package, Star, AlertTriangle, Warehouse } from "lucide-react";
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

// Top 10 products by revenue (horizontal bar)
const topProductsByRevenue = [
  { name: "Cà phê Arabica hạt rang", revenue: 152_000_000 },
  { name: "Cà phê Robusta nguyên chất", revenue: 128_500_000 },
  { name: "Cà phê Culi đặc biệt", revenue: 95_200_000 },
  { name: "Trà sen vàng túi lọc", revenue: 78_400_000 },
  { name: "Cacao sữa 3in1 hộp", revenue: 62_800_000 },
  { name: "Cà phê phin giấy drip", revenue: 54_300_000 },
  { name: "Trà ô long cao cấp", revenue: 48_700_000 },
  { name: "Matcha Nhật Bản", revenue: 42_100_000 },
  { name: "Cà phê sữa đá hòa tan", revenue: 38_500_000 },
  { name: "Bộ phin cà phê inox", revenue: 28_900_000 },
];

// Product category distribution (6 categories)
const categoryDistribution = [
  { name: "Cà phê hạt", value: 35 },
  { name: "Cà phê hòa tan", value: 18 },
  { name: "Trà các loại", value: 22 },
  { name: "Cacao & Socola", value: 10 },
  { name: "Phụ kiện pha chế", value: 8 },
  { name: "Bánh & Snack", value: 7 },
];

const PIE_COLORS = [
  "#2563eb",
  "#3b82f6",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
];

// Stock movement (Nhập vs Xuất over 30 days)
const stockMovement = Array.from({ length: 30 }, (_, i) => {
  const d = i + 1;
  const baseImport = 120 + Math.round(Math.sin(d * 0.5) * 40);
  const baseExport = 95 + Math.round(Math.cos(d * 0.7) * 35);
  const mondayBoost = d % 7 === 1 ? 80 : 0;
  const weekendBoost = d % 7 >= 5 ? 30 : 0;
  return {
    day: `${d.toString().padStart(2, "0")}/03`,
    nhập: Math.max(baseImport + mondayBoost, 50),
    xuất: Math.max(baseExport + weekendBoost, 40),
  };
});

// Low stock products
const lowStockProducts = [
  { name: "Cà phê Arabica Lâm Đồng 500g", stock: 5, warning: 20, unit: "gói" },
  { name: "Trà ô long Bảo Lộc hộp thiếc", stock: 3, warning: 15, unit: "hộp" },
  { name: "Phin cà phê nhôm cao cấp", stock: 8, warning: 25, unit: "cái" },
  { name: "Cacao nguyên chất Đắk Lắk", stock: 12, warning: 30, unit: "gói" },
  { name: "Ly sứ thương hiệu JD 250ml", stock: 7, warning: 50, unit: "cái" },
  { name: "Matcha Uji Nhật Bản 100g", stock: 4, warning: 10, unit: "hộp" },
  { name: "Giấy lọc cà phê size 02", stock: 15, warning: 100, unit: "hộp" },
  { name: "Trà hoa cúc mật ong túi lọc", stock: 6, warning: 20, unit: "hộp" },
  { name: "Cà phê Culi đặc biệt 1kg", stock: 9, warning: 15, unit: "gói" },
  { name: "Bình giữ nhiệt JD 500ml", stock: 11, warning: 30, unit: "cái" },
];

// === Custom Tooltips ===

function ProductRevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { name: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">
        {payload[0].payload.name}
      </p>
      <p className="text-sm font-bold text-blue-600">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function PieCategoryTooltip({
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
      <p className="text-sm font-bold">{payload[0].value} sản phẩm</p>
    </div>
  );
}

function StockMovementTooltip({
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
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">Ngày {label}</p>
      {payload.map((p) => (
        <p
          key={p.dataKey}
          className="text-sm font-bold"
          style={{ color: p.color }}
        >
          {p.dataKey === "nhập" ? "Nhập" : "Xuất"}: {p.value} sản phẩm
        </p>
      ))}
    </div>
  );
}

// Pie chart custom label
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

// === Page ===

export default function HangHoaPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích hàng hóa"
        subtitle="Thống kê sản phẩm, tồn kho và xuất nhập"
      />

      <div className="flex-1 p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng mặt hàng"
            value="156"
            change="+8 sản phẩm mới"
            positive
            icon={Package}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Hàng bán chạy"
            value="Cà phê Arabica"
            change="320 sản phẩm/tháng"
            positive
            icon={Star}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Hàng tồn kho thấp"
            value="10"
            change="Cần nhập thêm"
            positive={false}
            icon={AlertTriangle}
            bg="bg-red-50"
            iconColor="text-red-600"
            valueColor="text-red-700"
          />
          <KpiCard
            label="Giá trị tồn kho"
            value={formatCurrency(1_285_000_000) + "đ"}
            change="+5,2% so với tháng trước"
            positive
            icon={Warehouse}
            bg="bg-purple-50"
            iconColor="text-purple-600"
            valueColor="text-purple-700"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top 10 Products by Revenue - Horizontal Bar */}
          <ChartCard
            title="Top 10 sản phẩm theo doanh thu"
            subtitle="Tháng 03/2026"
          >
            <div className="h-72 md:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...topProductsByRevenue].reverse()}
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
                    width={140}
                  />
                  <Tooltip content={<ProductRevenueTooltip />} />
                  <Bar
                    dataKey="revenue"
                    fill="#2563eb"
                    radius={[0, 6, 6, 0]}
                    name="Doanh thu"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Product Category Distribution - Pie */}
          <ChartCard
            title="Phân bổ sản phẩm theo nhóm hàng"
            subtitle="156 sản phẩm"
          >
            <div className="h-72 md:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryDistribution}
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
                    {categoryDistribution.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PieCategoryTooltip />} />
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

        {/* Stock Movement Line Chart */}
        <ChartCard
          title="Biến động xuất nhập kho"
          subtitle="Nhập vs Xuất - Tháng 03/2026"
        >
          <div className="h-56 md:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={stockMovement}
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
                <Tooltip content={<StockMovementTooltip />} />
                <Legend
                  verticalAlign="top"
                  formatter={(value: string) => (
                    <span className="text-xs">
                      {value === "nhập" ? "Nhập kho" : "Xuất kho"}
                    </span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="nhập"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#16a34a" }}
                  name="nhập"
                />
                <Line
                  type="monotone"
                  dataKey="xuất"
                  stroke="#ea580c"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#ea580c" }}
                  name="xuất"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Low Stock Products Table */}
        <ChartCard
          title="Sản phẩm tồn kho thấp"
          subtitle="Cần nhập thêm hàng"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">
                    Sản phẩm
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">Tồn kho</th>
                  <th className="text-right py-2 pr-4 font-medium">
                    Mức cảnh báo
                  </th>
                  <th className="text-right py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {lowStockProducts.map((item) => {
                  const ratio = item.stock / item.warning;
                  const isCritical = ratio <= 0.3;
                  return (
                    <tr key={item.name} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{item.name}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span
                          className={
                            isCritical
                              ? "text-red-600 font-bold"
                              : "text-orange-600 font-medium"
                          }
                        >
                          {item.stock}
                        </span>{" "}
                        <span className="text-muted-foreground text-xs">
                          {item.unit}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-muted-foreground">
                        {item.warning} {item.unit}
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            isCritical
                              ? "bg-red-100 text-red-700"
                              : "bg-orange-100 text-orange-700"
                          }`}
                        >
                          {isCritical ? "Sắp hết" : "Thấp"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
