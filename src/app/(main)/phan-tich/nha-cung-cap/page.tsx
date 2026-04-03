"use client";

import { useState, useEffect, useCallback } from "react";
import { Truck, ShoppingBag, Wallet, RotateCcw, Loader2 } from "lucide-react";
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
import {
  getSupplierKpis,
  getPurchaseByMonth,
  getTopSuppliersByPurchase,
  getSupplierPaymentStatus,
  getSupplierSummary,
} from "@/lib/services";
import type {
  ChartPoint,
  SupplierSummaryRow,
} from "@/lib/services/supabase/analytics";

// === Helpers ===

const PAYMENT_COLORS = ["#16a34a", "#f59e0b", "#ef4444"];

function calcChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% so với tháng trước`;
}

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
  payload?: Array<{ value: number; payload: { name: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">
        {payload[0].payload.name}
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
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<{
    totalSuppliers: number;
    purchaseThisMonth: number;
    prevPurchase: number;
    totalDebt: number;
    prevDebt: number;
    returnCount: number;
  } | null>(null);
  const [purchaseByMonth, setPurchaseByMonth] = useState<ChartPoint[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<{ name: string; amount: number }[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<{ name: string; value: number }[]>([]);
  const [supplierTable, setSupplierTable] = useState<SupplierSummaryRow[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [kpiData, purchase, top, payment, summary] = await Promise.all([
        getSupplierKpis(),
        getPurchaseByMonth(),
        getTopSuppliersByPurchase(),
        getSupplierPaymentStatus(),
        getSupplierSummary(),
      ]);
      setKpis(kpiData);
      setPurchaseByMonth(purchase);
      setTopSuppliers(top);
      setPaymentStatus(payment);
      setSupplierTable(summary);
    } catch (err) {
      console.error("Failed to fetch supplier analytics:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-48px)]">
        <DateRangeBar
          title="Phân tích nhà cung cấp"
          subtitle="Thống kê mua hàng và công nợ nhà cung cấp"
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

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
            value={String(kpis?.totalSuppliers ?? 0)}
            change={`${kpis?.totalSuppliers ?? 0} nhà cung cấp`}
            positive
            icon={Truck}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Tổng mua tháng"
            value={formatCurrency(kpis?.purchaseThisMonth ?? 0)}
            change={calcChange(kpis?.purchaseThisMonth ?? 0, kpis?.prevPurchase ?? 0)}
            positive={(kpis?.purchaseThisMonth ?? 0) >= (kpis?.prevPurchase ?? 0)}
            icon={ShoppingBag}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Công nợ NCC"
            value={formatCurrency(kpis?.totalDebt ?? 0)}
            change={calcChange(kpis?.totalDebt ?? 0, kpis?.prevDebt ?? 0)}
            positive={(kpis?.totalDebt ?? 0) <= (kpis?.prevDebt ?? 0)}
            icon={Wallet}
            bg="bg-orange-50"
            iconColor="text-orange-600"
            valueColor="text-orange-700"
          />
          <KpiCard
            label="Trả hàng NCC"
            value={String(kpis?.returnCount ?? 0)}
            change={`${kpis?.returnCount ?? 0} phiếu trả hàng`}
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
              {purchaseByMonth.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Chưa có dữ liệu mua hàng
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={purchaseByMonth}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
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
                      dataKey="value"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ fill: "#2563eb", r: 4 }}
                      activeDot={{ r: 6, fill: "#2563eb" }}
                      name="Giá trị mua"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </ChartCard>

          {/* Top 5 suppliers horizontal bar */}
          <ChartCard title="Top 5 nhà cung cấp" subtitle="Theo giá trị mua hàng">
            <div className="h-64">
              {topSuppliers.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Chưa có dữ liệu nhà cung cấp
                </div>
              ) : (
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
              )}
            </div>
          </ChartCard>
        </div>

        {/* Payment status pie chart */}
        <ChartCard title="Tình trạng thanh toán NCC" subtitle="Tổng hợp công nợ">
          <div className="h-72">
            {paymentStatus.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Chưa có dữ liệu thanh toán
              </div>
            ) : (
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
            )}
          </div>
        </ChartCard>

        {/* Supplier table */}
        <ChartCard title="Bảng tổng hợp nhà cung cấp">
          {supplierTable.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có dữ liệu nhà cung cấp
            </div>
          ) : (
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
          )}
        </ChartCard>
      </div>
    </div>
  );
}
