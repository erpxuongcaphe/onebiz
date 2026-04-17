"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { useBranchFilter } from "@/lib/contexts";
import { formatCurrency, formatChartCurrency, formatChartTooltipCurrency } from "@/lib/format";
import { getCashFlowDetailed } from "@/lib/services/supabase/analytics";
import type { CashFlowDetailedRow } from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";

// ── Custom Tooltip ──
function CashFlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-2.5 shadow-md text-xs space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatChartTooltipCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LuongTienPage() {
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<CashFlowDetailedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCashFlowDetailed(6, activeBranchId);
      setData(result);
    } catch {
      // silent fail — data stays empty
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate current month KPIs
  const current = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;
  const totalReceipt = current?.totalReceipt ?? 0;
  const totalPayment = current?.totalPayment ?? 0;
  const net = current?.net ?? 0;
  const balance = current?.cumulativeBalance ?? 0;

  // Chart data for stacked bar
  const chartData = data.map((d) => ({
    month: d.month,
    "Thu vào": d.totalReceipt,
    "Chi ra": d.totalPayment,
  }));

  // Cumulative balance line chart
  const balanceData = data.map((d) => ({
    month: d.month,
    "Số dư luỹ kế": d.cumulativeBalance,
    "Dòng tiền ròng": d.net,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Luồng tiền</h1>
        <p className="text-sm text-muted-foreground">
          Phân tích dòng tiền vào/ra 6 tháng gần nhất
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Thu tháng này"
          value={formatCurrency(totalReceipt)}
          icon="north_east"
          bg="bg-green-50"
          iconColor="text-green-600"
          valueColor="text-foreground"
          change={prev ? `${((totalReceipt - prev.totalReceipt) / Math.max(prev.totalReceipt, 1) * 100).toFixed(1)}%` : undefined}
          positive={prev ? totalReceipt >= prev.totalReceipt : undefined}
        />
        <KpiCard
          label="Chi tháng này"
          value={formatCurrency(totalPayment)}
          icon="south_east"
          bg="bg-red-50"
          iconColor="text-red-500"
          valueColor="text-foreground"
          change={prev ? `${((totalPayment - prev.totalPayment) / Math.max(prev.totalPayment, 1) * 100).toFixed(1)}%` : undefined}
          positive={prev ? totalPayment <= prev.totalPayment : undefined}
        />
        <KpiCard
          label="Dòng tiền ròng"
          value={formatCurrency(net)}
          icon={net >= 0 ? "trending_up" : "trending_down"}
          bg={net >= 0 ? "bg-primary-fixed" : "bg-orange-50"}
          iconColor={net >= 0 ? "text-primary" : "text-orange-600"}
          valueColor="text-foreground"
          positive={net >= 0}
        />
        <KpiCard
          label="Số dư luỹ kế"
          value={formatCurrency(balance)}
          icon="account_balance_wallet"
          bg="bg-purple-50"
          iconColor="text-purple-600"
          valueColor="text-foreground"
          positive={balance >= 0}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Thu - Chi theo tháng">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<CashFlowTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Thu vào" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Chi ra" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Dòng tiền ròng & Số dư luỹ kế">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={balanceData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<CashFlowTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Dòng tiền ròng" stroke="#004AC6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Số dư luỹ kế" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Detail Table */}
      <ChartCard title="Chi tiết theo tháng">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 px-3 font-medium">Tháng</th>
                <th className="py-2 px-3 font-medium text-right">Tổng thu</th>
                <th className="py-2 px-3 font-medium text-right">Tổng chi</th>
                <th className="py-2 px-3 font-medium text-right">Ròng</th>
                <th className="py-2 px-3 font-medium text-right">Số dư luỹ kế</th>
                <th className="py-2 px-3 font-medium">Chi tiết thu</th>
                <th className="py-2 px-3 font-medium">Chi tiết chi</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.month} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3 font-medium">{row.month}</td>
                  <td className="py-2 px-3 text-right text-green-600 font-medium">
                    {formatCurrency(row.totalReceipt)}
                  </td>
                  <td className="py-2 px-3 text-right text-red-500 font-medium">
                    {formatCurrency(row.totalPayment)}
                  </td>
                  <td className={`py-2 px-3 text-right font-bold ${row.net >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {row.net >= 0 ? "+" : ""}{formatCurrency(row.net)}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${row.cumulativeBalance >= 0 ? "text-primary" : "text-red-500"}`}>
                    {formatCurrency(row.cumulativeBalance)}
                  </td>
                  <td className="py-2 px-3">
                    <div className="space-y-0.5">
                      {row.receipts.slice(0, 3).map((r) => (
                        <div key={r.category} className="text-xs text-muted-foreground">
                          {r.category}: <span className="font-medium text-foreground">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                      {row.receipts.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="space-y-0.5">
                      {row.payments.slice(0, 3).map((p) => (
                        <div key={p.category} className="text-xs text-muted-foreground">
                          {p.category}: <span className="font-medium text-foreground">{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                      {row.payments.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
