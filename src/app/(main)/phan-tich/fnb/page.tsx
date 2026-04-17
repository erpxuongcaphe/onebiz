"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import { useBranchFilter } from "@/lib/contexts";
import { formatCurrency, formatChartCurrency, formatChartTooltipCurrency } from "@/lib/format";
import {
  getFnbKpis,
  getRevenueByMenuItem,
  getRevenueByTable,
  getRevenueByHourFnb,
  getCashierPerformance,
} from "@/lib/services";
import type {
  FnbKpis,
  MenuItemRevenue,
  TableRevenue,
  HourlyRevenue,
  CashierPerformance,
} from "@/lib/services/supabase/fnb-analytics";
import { Icon } from "@/components/ui/icon";

// === Tooltips ===

function HourTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm font-bold text-primary">
          {p.dataKey === "revenue"
            ? formatChartTooltipCurrency(p.value)
            : `${p.value} đơn`}
        </p>
      ))}
    </div>
  );
}

const COLORS = [
  "#004AC6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#e11d48", "#a855f7", "#22c55e", "#eab308",
];

export default function FnbAnalyticsPage() {
  const { activeBranchId } = useBranchFilter();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<FnbKpis | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemRevenue[]>([]);
  const [tables, setTables] = useState<TableRevenue[]>([]);
  const [hourly, setHourly] = useState<HourlyRevenue[]>([]);
  const [cashiers, setCashiers] = useState<CashierPerformance[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [k, m, t, h, c] = await Promise.all([
          getFnbKpis(activeBranchId),
          getRevenueByMenuItem(activeBranchId),
          getRevenueByTable(activeBranchId),
          getRevenueByHourFnb(activeBranchId),
          getCashierPerformance(activeBranchId),
        ]);
        setKpis(k);
        setMenuItems(m);
        setTables(t);
        setHourly(h);
        setCashiers(c);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [activeBranchId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <DateRangeBar title="Báo cáo F&B" subtitle="Doanh thu theo món, bàn, giờ, nhân viên" />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        <KpiCard
          label="Tổng doanh thu F&B"
          value={formatCurrency(kpis?.totalRevenue ?? 0)}
          icon="attach_money"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Số đơn"
          value={String(kpis?.totalOrders ?? 0)}
          icon="shopping_cart"
          bg="bg-green-50"
          iconColor="text-green-600"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Trung bình/đơn"
          value={formatCurrency(kpis?.avgTicket ?? 0)}
          icon="receipt"
          bg="bg-purple-50"
          iconColor="text-purple-600"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Turnover trung bình"
          value={`${kpis?.avgTurnoverMinutes ?? 0} phút`}
          icon="schedule"
          bg="bg-orange-50"
          iconColor="text-orange-600"
          valueColor="text-foreground"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
        {/* Revenue by Hour */}
        <ChartCard title="Doanh thu theo giờ" subtitle="Phân bổ doanh thu trong ngày">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly.filter((h) => h.revenue > 0 || h.orders > 0)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} />
                <Tooltip content={<HourTooltip />} />
                <Bar dataKey="revenue" fill="#004AC6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Top Menu Items */}
        <ChartCard title="Top món bán chạy" subtitle="Theo doanh thu">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={menuItems.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} />
                <YAxis
                  dataKey="productName"
                  type="category"
                  width={120}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value) => formatChartTooltipCurrency(Number(value))}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {menuItems.slice(0, 10).map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Revenue by Table */}
        <ChartCard title="Doanh thu theo bàn" subtitle="Bàn nào bán nhiều nhất">
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tables.map((t, idx) => {
                const maxRevenue = tables[0]?.revenue || 1;
                const pct = (t.revenue / maxRevenue) * 100;
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-xs text-foreground w-20 shrink-0 truncate">
                      {t.tableName}
                    </span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-foreground shrink-0 w-24 text-right">
                      {formatCurrency(t.revenue)}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {t.orders} đơn
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>

        {/* Cashier Performance */}
        <ChartCard title="Hiệu suất nhân viên" subtitle="Doanh thu và số đơn theo nhân viên">
          {cashiers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 text-xs font-medium text-muted-foreground">Nhân viên</th>
                    <th className="py-2 text-xs font-medium text-muted-foreground text-right">Doanh thu</th>
                    <th className="py-2 text-xs font-medium text-muted-foreground text-right">Số đơn</th>
                    <th className="py-2 text-xs font-medium text-muted-foreground text-right">TB/đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {cashiers.map((c, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 font-medium">{c.cashierName}</td>
                      <td className="py-2 text-right">{formatCurrency(c.revenue)}</td>
                      <td className="py-2 text-right">{c.orders}</td>
                      <td className="py-2 text-right text-muted-foreground">
                        {formatCurrency(c.avgTicket)}
                      </td>
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
