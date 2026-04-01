"use client";

import { useState } from "react";
import { TrendingUp, ShoppingCart, Users, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
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

// === KPI Data ===
const kpiData = [
  {
    label: "Doanh thu hôm nay",
    value: 28500000,
    formatted: formatCurrency(28500000),
    change: "+12.5%",
    positive: true,
    icon: DollarSign,
    bg: "bg-blue-50",
    iconColor: "text-blue-600",
    valueColor: "text-blue-700",
  },
  {
    label: "Đơn hàng hôm nay",
    value: 47,
    formatted: "47",
    change: "+8 đơn",
    positive: true,
    icon: ShoppingCart,
    bg: "bg-green-50",
    iconColor: "text-green-600",
    valueColor: "text-green-700",
  },
  {
    label: "Khách mới tháng này",
    value: 23,
    formatted: "23",
    change: "+5 so với tháng trước",
    positive: true,
    icon: Users,
    bg: "bg-purple-50",
    iconColor: "text-purple-600",
    valueColor: "text-purple-700",
  },
  {
    label: "Lợi nhuận tháng",
    value: 156000000,
    formatted: formatCurrency(156000000),
    change: "+18.2%",
    positive: true,
    icon: TrendingUp,
    bg: "bg-orange-50",
    iconColor: "text-orange-600",
    valueColor: "text-orange-700",
  },
];

// === 30-day revenue trend ===
const revenueTrend = Array.from({ length: 30 }, (_, i) => {
  const d = i + 1;
  // Simulate realistic daily revenue with weekend bumps
  const base = 28_000_000;
  const dayOfWeek = (d + 1) % 7; // approx
  const weekendBoost = dayOfWeek >= 5 ? 15_000_000 : 0;
  const noise = Math.round((Math.sin(d * 1.3) * 8_000_000 + Math.cos(d * 0.7) * 5_000_000));
  const revenue = base + weekendBoost + noise + d * 200_000;
  return {
    day: `${d.toString().padStart(2, "0")}/03`,
    revenue: Math.max(revenue, 15_000_000),
  };
});

// === Revenue by category ===
const revenueByCategory = [
  { category: "Cà phê", revenue: 185000000 },
  { category: "Trà", revenue: 92000000 },
  { category: "Cacao & Socola", revenue: 45000000 },
  { category: "Phụ kiện", revenue: 28000000 },
  { category: "Bánh & Snack", revenue: 18500000 },
];

const CATEGORY_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2"];

// === Top 10 products by revenue (horizontal bar) ===
const topRevenueProducts = [
  { rank: 1, name: "Cà phê Arabica hạt rang", revenue: 45200000, qty: 320 },
  { rank: 2, name: "Cà phê Robusta nguyên chất", revenue: 38700000, qty: 285 },
  { rank: 3, name: "Trà sen vàng túi lọc", revenue: 28500000, qty: 190 },
  { rank: 4, name: "Cacao sữa 3in1 hộp", revenue: 22800000, qty: 456 },
  { rank: 5, name: "Cà phê phin giấy drip", revenue: 19500000, qty: 260 },
  { rank: 6, name: "Trà ô long cao cấp", revenue: 17200000, qty: 115 },
  { rank: 7, name: "Cà phê sữa đá hòa tan", revenue: 15800000, qty: 632 },
  { rank: 8, name: "Matcha Nhật Bản", revenue: 14300000, qty: 95 },
  { rank: 9, name: "Trà đào cam sả gói", revenue: 12100000, qty: 242 },
  { rank: 10, name: "Bộ phin cà phê inox", revenue: 9800000, qty: 49 },
];

// === Products by category distribution (PieChart) ===
const productsByCategory = [
  { name: "Cà phê", value: 42 },
  { name: "Trà", value: 28 },
  { name: "Cacao & Socola", value: 12 },
  { name: "Phụ kiện", value: 10 },
  { name: "Bánh & Snack", value: 8 },
];

const PIE_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2"];

// === Top 10 products by qty ===
const topProducts = [
  { rank: 1, name: "Cà phê sữa đá hòa tan", qty: 632, revenue: 15800000 },
  { rank: 2, name: "Cacao sữa 3in1 hộp", qty: 456, revenue: 22800000 },
  { rank: 3, name: "Cà phê Arabica hạt rang", qty: 320, revenue: 45200000 },
  { rank: 4, name: "Cà phê Robusta nguyên chất", qty: 285, revenue: 38700000 },
  { rank: 5, name: "Cà phê phin giấy drip", qty: 260, revenue: 19500000 },
  { rank: 6, name: "Trà đào cam sả gói", qty: 242, revenue: 12100000 },
  { rank: 7, name: "Trà sen vàng túi lọc", qty: 190, revenue: 28500000 },
  { rank: 8, name: "Trà ô long cao cấp", qty: 115, revenue: 17200000 },
  { rank: 9, name: "Matcha Nhật Bản", qty: 95, revenue: 14300000 },
  { rank: 10, name: "Bộ phin cà phê inox", qty: 49, revenue: 9800000 },
];

// === Top 10 customers ===
const topCustomers = [
  { rank: 1, name: "Chuỗi The Coffee House clone", orders: 128, revenue: 350000000 },
  { rank: 2, name: "Công ty Phân Phối Miền Nam", orders: 95, revenue: 500000000 },
  { rank: 3, name: "Công ty TNHH ABC Coffee", orders: 67, revenue: 120000000 },
  { rank: 4, name: "Quán Cà Phê Bùi Thanh Tâm", orders: 54, revenue: 85000000 },
  { rank: 5, name: "Lê Văn Đức", orders: 32, revenue: 25000000 },
  { rank: 6, name: "Đỗ Quang Huy", orders: 28, revenue: 18500000 },
  { rank: 7, name: "Nguyễn Minh Tuấn", orders: 24, revenue: 15000000 },
  { rank: 8, name: "Hoàng Anh Dũng", orders: 19, revenue: 9800000 },
  { rank: 9, name: "Trần Thị Hoa", orders: 15, revenue: 8200000 },
  { rank: 10, name: "Phạm Ngọc Anh", orders: 12, revenue: 6700000 },
];

// === Top customers spending (for bar chart) ===
const topCustomersChart = topCustomers.slice(0, 10).map((c) => ({
  name: c.name.length > 18 ? c.name.slice(0, 18) + "..." : c.name,
  fullName: c.name,
  revenue: c.revenue,
}));

// === New customers per month (last 6 months) ===
const newCustomersMonthly = [
  { month: "T10/2025", count: 12 },
  { month: "T11/2025", count: 18 },
  { month: "T12/2025", count: 15 },
  { month: "T01/2026", count: 22 },
  { month: "T02/2026", count: 19 },
  { month: "T03/2026", count: 23 },
];

// === Custom Tooltips ===

function RevenueTrendTooltip({
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

function CategoryRevenueTooltip({
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
        Doanh thu: {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function PieTooltip({
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
        {payload[0].value} sản phẩm
      </p>
    </div>
  );
}

function CustomerRevenueTooltip({
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
        Doanh thu: {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

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
      <p className="text-sm font-bold text-purple-600">
        {payload[0].value} khách mới
      </p>
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
  if (percent < 0.08) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function PhanTichPage() {
  const [activeTab, setActiveTab] = useState("revenue");

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <PageHeader title="Phân tích" />

      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {kpiData.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <Card key={kpi.label} className={kpi.bg + " border-0"}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">
                      {kpi.label}
                    </span>
                    <Icon className={`h-4 w-4 ${kpi.iconColor}`} />
                  </div>
                  <p className={`text-xl md:text-2xl font-bold ${kpi.valueColor}`}>
                    {kpi.formatted}
                  </p>
                  <p className="text-xs text-green-600 mt-1">{kpi.change}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="revenue">Doanh thu</TabsTrigger>
            <TabsTrigger value="products">Hàng hóa</TabsTrigger>
            <TabsTrigger value="customers">Khách hàng</TabsTrigger>
          </TabsList>

          {/* === Doanh thu Tab === */}
          <TabsContent value="revenue" className="mt-4 space-y-4">
            {/* Revenue trend line chart - 30 days */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Xu hướng doanh thu 30 ngày (Tháng 03/2026)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48 md:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={revenueTrend}
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
                      <Tooltip content={<RevenueTrendTooltip />} />
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
              </CardContent>
            </Card>

            {/* Revenue by category bar chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Doanh thu theo nhóm hàng (Top 5)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48 md:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={revenueByCategory}
                      margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="category"
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
                      <Tooltip content={<CategoryRevenueTooltip />} />
                      <Bar dataKey="revenue" radius={[6, 6, 0, 0]} name="Doanh thu">
                        {revenueByCategory.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Table kept as-is */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Top 10 sản phẩm theo doanh thu
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">#</th>
                        <th className="text-left py-2 pr-4 font-medium">
                          Sản phẩm
                        </th>
                        <th className="text-right py-2 pr-4 font-medium">
                          SL bán
                        </th>
                        <th className="text-right py-2 font-medium">
                          Doanh thu
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topRevenueProducts.map((item) => (
                        <tr key={item.rank} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.rank}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            {item.qty}
                          </td>
                          <td className="py-2.5 text-right font-medium text-primary">
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === Hang hoa Tab === */}
          <TabsContent value="products" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top 10 products by revenue - horizontal bar */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Top 10 sản phẩm theo doanh thu
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 md:h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[...topRevenueProducts].reverse()}
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
                          width={130}
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
                </CardContent>
              </Card>

              {/* Products by category - PieChart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Phân bổ sản phẩm theo nhóm hàng
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 md:h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={productsByCategory}
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
                          {productsByCategory.map((_, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={PIE_COLORS[index % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                        <Legend
                          verticalAlign="bottom"
                          formatter={(value: string) => (
                            <span className="text-xs">{value}</span>
                          )}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Top 10 sản phẩm bán chạy (theo số lượng)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">#</th>
                        <th className="text-left py-2 pr-4 font-medium">
                          Sản phẩm
                        </th>
                        <th className="text-right py-2 pr-4 font-medium">
                          SL bán
                        </th>
                        <th className="text-right py-2 font-medium">
                          Doanh thu
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((item) => (
                        <tr key={item.rank} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.rank}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-medium text-green-600">
                            {item.qty}
                          </td>
                          <td className="py-2.5 text-right">
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === Khach hang Tab === */}
          <TabsContent value="customers" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top customers by spending - bar chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Top 10 khách hàng theo doanh thu
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 md:h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[...topCustomersChart].reverse()}
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
                        <Tooltip content={<CustomerRevenueTooltip />} />
                        <Bar
                          dataKey="revenue"
                          fill="#ea580c"
                          radius={[0, 6, 6, 0]}
                          name="Doanh thu"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* New customers per month - line chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Khách hàng mới theo tháng (6 tháng gần nhất)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 md:h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
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
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="#9333ea"
                          strokeWidth={2}
                          dot={{ fill: "#9333ea", r: 4 }}
                          activeDot={{ r: 6, fill: "#9333ea" }}
                          name="Khách mới"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Top 10 khách hàng theo doanh thu
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">#</th>
                        <th className="text-left py-2 pr-4 font-medium">
                          Khách hàng
                        </th>
                        <th className="text-right py-2 pr-4 font-medium">
                          Số đơn
                        </th>
                        <th className="text-right py-2 font-medium">
                          Doanh thu
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCustomers.map((item) => (
                        <tr key={item.rank} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.rank}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            {item.orders}
                          </td>
                          <td className="py-2.5 text-right font-medium text-primary">
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
