"use client";

import { useState, useEffect, useCallback } from "react";
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
import { useBranchFilter } from "@/lib/contexts";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getInventoryKpis,
  getTopProductsByRevenue,
  getCategoryDistribution,
  getStockMovements,
  getAnalyticsLowStock,
} from "@/lib/services";
import type {
  TopProductRevenue,
  StockMovementPoint,
  LowStockItem,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";

const PIE_COLORS = [
  "#004AC6",
  "#9CB9FF",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
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
      <p className="text-sm font-bold text-primary">
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
          {p.dataKey === "nhap" ? "Nhập" : "Xuất"}: {p.value} sản phẩm
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

interface InventoryKpis {
  totalProducts: number;
  bestSeller: { name: string; qty: number };
  lowStockCount: number;
  stockValue: number;
}

export default function HangHoaPage() {
  const { activeBranchId } = useBranchFilter();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<InventoryKpis | null>(null);
  const [topProducts, setTopProducts] = useState<TopProductRevenue[]>([]);
  const [categories, setCategories] = useState<{ name: string; value: number }[]>([]);
  const [movements, setMovements] = useState<StockMovementPoint[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiData, topData, catData, moveData, lowData] = await Promise.all([
        getInventoryKpis(),
        getTopProductsByRevenue(10, activeBranchId),
        getCategoryDistribution(),
        getStockMovements(30, activeBranchId),
        getAnalyticsLowStock(),
      ]);
      setKpis(kpiData);
      setTopProducts(topData);
      setCategories(catData);
      setMovements(moveData);
      setLowStock(lowData);
    } catch (err) {
      console.error("Failed to fetch inventory analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] items-center justify-center">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Đang tải dữ liệu...</p>
      </div>
    );
  }

  const totalProducts = kpis?.totalProducts ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      <DateRangeBar
        title="Phân tích hàng hóa"
        subtitle="Thống kê sản phẩm, tồn kho và xuất nhập"
      />

      <div className="flex-1 p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng mặt hàng"
            value={String(totalProducts)}
            change={totalProducts > 0 ? `${totalProducts} sản phẩm` : "Chưa có dữ liệu"}
            positive={totalProducts > 0}
            icon="inventory_2"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Hàng bán chạy"
            value={kpis?.bestSeller.name ?? "N/A"}
            change={kpis?.bestSeller.qty ? `${kpis.bestSeller.qty} sản phẩm/tháng` : "Chưa có dữ liệu"}
            positive={(kpis?.bestSeller.qty ?? 0) > 0}
            icon="star"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Hàng tồn kho thấp"
            value={String(kpis?.lowStockCount ?? 0)}
            change={(kpis?.lowStockCount ?? 0) > 0 ? "Cần nhập thêm" : "Đủ hàng"}
            positive={(kpis?.lowStockCount ?? 0) === 0}
            icon="warning"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Giá trị tồn kho"
            value={formatCurrency(kpis?.stockValue ?? 0) + "đ"}
            change={(kpis?.stockValue ?? 0) > 0 ? "Giá trị hiện tại" : "Chưa có dữ liệu"}
            positive={(kpis?.stockValue ?? 0) > 0}
            icon="warehouse"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top 10 Products by Revenue - Horizontal Bar */}
          <ChartCard
            title="Top 10 sản phẩm theo doanh thu"
            subtitle={`Tổng ${topProducts.length} sản phẩm`}
          >
            <div className="h-72 md:h-96">
              {topProducts.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu sản phẩm
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[...topProducts].reverse()}
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
                      fill="#004AC6"
                      radius={[0, 6, 6, 0]}
                      name="Doanh thu"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </ChartCard>

          {/* Product Category Distribution - Pie */}
          <ChartCard
            title="Phân bổ sản phẩm theo nhóm hàng"
            subtitle={`${totalProducts} sản phẩm`}
          >
            <div className="h-72 md:h-96">
              {categories.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Chưa có dữ liệu nhóm hàng
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categories}
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
                      {categories.map((_, index) => (
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
              )}
            </div>
          </ChartCard>
        </div>

        {/* Stock Movement Line Chart */}
        <ChartCard
          title="Biến động xuất nhập kho"
          subtitle="Nhập vs Xuất"
        >
          <div className="h-56 md:h-72">
            {movements.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Chưa có dữ liệu xuất nhập kho
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={movements}
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
                        {value === "nhap" ? "Nhập kho" : "Xuất kho"}
                      </span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="nhap"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#16a34a" }}
                    name="nhap"
                  />
                  <Line
                    type="monotone"
                    dataKey="xuat"
                    stroke="#ea580c"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#ea580c" }}
                    name="xuat"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        {/* Low Stock Products Table */}
        <ChartCard
          title="Sản phẩm tồn kho thấp"
          subtitle="Cần nhập thêm hàng"
        >
          <div className="overflow-x-auto">
            {lowStock.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                Không có sản phẩm tồn kho thấp
              </div>
            ) : (
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
                  {lowStock.map((item) => {
                    const ratio = item.stock / item.warning;
                    const isCritical = ratio <= 0.3;
                    return (
                      <tr key={item.name} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 font-medium">{item.name}</td>
                        <td className="py-2.5 pr-4 text-right">
                          <span
                            className={
                              isCritical
                                ? "text-status-error font-bold"
                                : "text-status-warning font-medium"
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
                                ? "bg-status-error/10 text-status-error"
                                : "bg-status-warning/10 text-status-warning"
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
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
