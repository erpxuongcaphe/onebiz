"use client";

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  BarChart3,
  RotateCcw,
  Clock,
  Loader2,
  Building2,
} from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { getClient } from "@/lib/services/supabase/base";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
  getProfitAndLoss,
  getCOGSBreakdown,
  getGrossMarginTrend,
  getInventoryTurnover,
  getDSO,
} from "@/lib/services";
import type {
  ProfitAndLoss,
  COGSItem,
  GrossMarginTrend,
  InventoryTurnoverResult,
  DSOResult,
} from "@/lib/services/supabase/reports";

// === Helpers ===

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// === Custom Tooltips ===

function MarginTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Array<{ value: number; name: string; color: string; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm" style={{ color: p.color }}>
          {p.name}:{" "}
          <span className="font-bold">
            {p.dataKey === "grossMargin"
              ? `${p.value}%`
              : formatChartTooltipCurrency(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

function COGSTooltip({
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

export default function BaoCaoTaiChinhPage() {
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchId] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [pnl, setPnl] = useState<{
    current: ProfitAndLoss;
    previous: ProfitAndLoss;
  } | null>(null);
  const [cogsItems, setCogsItems] = useState<COGSItem[]>([]);
  const [marginTrend, setMarginTrend] = useState<GrossMarginTrend[]>([]);
  const [turnover, setTurnover] = useState<InventoryTurnoverResult | null>(null);
  const [dso, setDso] = useState<DSOResult | null>(null);

  // Fetch branches once
  useEffect(() => {
    (async () => {
      const supabase = getClient();
      const { data } = await supabase.from("branches").select("id, name").eq("is_active", true);
      setBranches((data ?? []).map(b => ({ id: b.id, name: b.name })));
    })();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const bid = branchId === "all" ? undefined : branchId;
      const [pnlRes, cogsRes, marginRes, turnoverRes, dsoRes] =
        await Promise.all([
          getProfitAndLoss(bid),
          getCOGSBreakdown(10),
          getGrossMarginTrend(6),
          getInventoryTurnover(),
          getDSO(),
        ]);
      setPnl(pnlRes);
      setCogsItems(cogsRes);
      setMarginTrend(marginRes);
      setTurnover(turnoverRes);
      setDso(dsoRes);
    } catch (err) {
      console.error("Failed to fetch P&L data:", err);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-48px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Đang tải báo cáo...
        </p>
      </div>
    );
  }

  const cur = pnl?.current;
  const prev = pnl?.previous;

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <DateRangeBar
        title="Báo cáo tài chính (P&L)"
        subtitle="Lãi/Lỗ, Giá vốn, Biên lợi nhuận"
      />

      {/* Branch filter */}
      {branches.length > 1 && (
        <div className="px-4 md:px-6 pt-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <Select value={branchId} onValueChange={(v) => setBranchId(v ?? "all")}>
            <SelectTrigger className="w-52 h-8 text-xs">
              <SelectValue placeholder="Tất cả chi nhánh" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả chi nhánh</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={cur ? formatCurrency(cur.revenue) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.revenue, prev.revenue)} so với tháng trước`
                : ""
            }
            positive={cur && prev ? cur.revenue >= prev.revenue : true}
            icon={TrendingUp}
            bg="bg-blue-50"
            iconColor="text-blue-600"
            valueColor="text-blue-700"
          />
          <KpiCard
            label="Giá vốn (COGS)"
            value={cur ? formatCurrency(cur.cogs) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.cogs, prev.cogs)} so với tháng trước`
                : ""
            }
            positive={cur && prev ? cur.cogs <= prev.cogs : true}
            icon={TrendingDown}
            bg="bg-orange-50"
            iconColor="text-orange-600"
            valueColor="text-orange-700"
          />
          <KpiCard
            label="Lãi ròng"
            value={cur ? formatCurrency(cur.netProfit) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.netProfit, prev.netProfit)} so với tháng trước`
                : ""
            }
            positive={cur && prev ? cur.netProfit >= prev.netProfit : true}
            icon={DollarSign}
            bg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-700"
          />
          <KpiCard
            label="Biên LN gộp"
            value={cur ? `${cur.grossMargin}%` : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.grossMargin, prev.grossMargin)} so với tháng trước`
                : ""
            }
            positive={
              cur && prev ? cur.grossMargin >= prev.grossMargin : true
            }
            icon={Percent}
            bg="bg-purple-50"
            iconColor="text-purple-600"
            valueColor="text-purple-700"
          />
        </div>

        {/* P&L Table */}
        <ChartCard
          title="Bảng Lãi/Lỗ (P&L)"
          subtitle="So sánh tháng hiện tại và tháng trước"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Khoản mục</th>
                  <th className="text-right py-2 pr-4 font-medium">
                    {cur?.period ?? "Tháng này"}
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">
                    {prev?.period ?? "Tháng trước"}
                  </th>
                  <th className="text-right py-2 font-medium">Thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Doanh thu",
                    cur: cur?.revenue ?? 0,
                    prev: prev?.revenue ?? 0,
                    bold: true,
                    color: "text-blue-700",
                  },
                  {
                    label: "(-) Giá vốn hàng bán (COGS)",
                    cur: cur?.cogs ?? 0,
                    prev: prev?.cogs ?? 0,
                    negative: true,
                  },
                  {
                    label: "= Lãi gộp",
                    cur: cur?.grossProfit ?? 0,
                    prev: prev?.grossProfit ?? 0,
                    bold: true,
                    color: "text-green-700",
                  },
                  {
                    label: "   Biên LN gộp (%)",
                    cur: cur?.grossMargin ?? 0,
                    prev: prev?.grossMargin ?? 0,
                    isPercent: true,
                  },
                  {
                    label: "(-) Chi phí vận hành",
                    cur: cur?.operatingExpense ?? 0,
                    prev: prev?.operatingExpense ?? 0,
                    negative: true,
                  },
                  {
                    label: "= Lãi ròng",
                    cur: cur?.netProfit ?? 0,
                    prev: prev?.netProfit ?? 0,
                    bold: true,
                    color: "text-green-700",
                    highlight: true,
                  },
                  {
                    label: "   Biên LN ròng (%)",
                    cur: cur?.netMargin ?? 0,
                    prev: prev?.netMargin ?? 0,
                    isPercent: true,
                  },
                ].map((row) => {
                  const change = row.isPercent
                    ? `${(row.cur - row.prev).toFixed(1)}pp`
                    : pctChange(row.cur, row.prev);
                  const isPositiveChange = row.negative
                    ? row.cur <= row.prev
                    : row.cur >= row.prev;

                  return (
                    <tr
                      key={row.label}
                      className={`border-b last:border-0 ${row.highlight ? "bg-green-50/50" : ""}`}
                    >
                      <td
                        className={`py-2.5 pr-4 ${row.bold ? "font-semibold" : ""} ${row.color ?? ""}`}
                      >
                        {row.label}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium">
                        {row.isPercent
                          ? `${row.cur}%`
                          : formatCurrency(row.cur)}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-muted-foreground">
                        {row.isPercent
                          ? `${row.prev}%`
                          : formatCurrency(row.prev)}
                      </td>
                      <td
                        className={`py-2.5 text-right text-xs font-medium ${isPositiveChange ? "text-green-600" : "text-red-600"}`}
                      >
                        {change}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>

        {/* Gross Margin Trend + COGS Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Gross Margin Trend */}
          <ChartCard
            title="Xu hướng biên lợi nhuận gộp"
            subtitle="6 tháng gần nhất"
          >
            {marginTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={marginTrend}
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
                      yAxisId="left"
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={(v: number) => `${v}%`}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip content={<MarginTooltip />} />
                    <Legend
                      verticalAlign="top"
                      formatter={(value: string) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="revenue"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ fill: "#2563eb", r: 3 }}
                      name="Doanh thu"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="cogs"
                      stroke="#ea580c"
                      strokeWidth={2}
                      dot={{ fill: "#ea580c", r: 3 }}
                      name="Giá vốn"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="grossMargin"
                      stroke="#16a34a"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ fill: "#16a34a", r: 3 }}
                      name="Biên LN gộp (%)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          {/* COGS Breakdown Bar Chart */}
          <ChartCard
            title="Top sản phẩm theo giá vốn"
            subtitle="Tháng hiện tại"
          >
            {cogsItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu giá vốn.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={cogsItems.slice(0, 7)}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="productName"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={100}
                    />
                    <Tooltip content={<COGSTooltip />} />
                    <Bar
                      dataKey="totalCost"
                      radius={[0, 6, 6, 0]}
                      name="Giá vốn"
                    >
                      {cogsItems.slice(0, 7).map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            index < 3
                              ? "#ea580c"
                              : index < 5
                                ? "#f97316"
                                : "#fdba74"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Operational KPIs: Inventory Turnover + DSO */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Vòng quay hàng tồn kho"
            subtitle="Tháng hiện tại"
          >
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <RotateCcw className="size-4" />
                  <span className="text-xs">Vòng quay</span>
                </div>
                <p className="text-3xl font-bold text-primary">
                  {turnover?.turnoverRatio ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">lần/tháng</p>
              </div>
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Clock className="size-4" />
                  <span className="text-xs">TB ngày bán hết</span>
                </div>
                <p className="text-3xl font-bold text-orange-600">
                  {turnover?.avgDaysToSell ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">ngày</p>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Giá vốn bán trong kỳ
                </span>
                <span className="font-medium">
                  {formatCurrency(turnover?.totalCogsPeriod ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Giá trị tồn kho TB
                </span>
                <span className="font-medium">
                  {formatCurrency(turnover?.avgInventoryValue ?? 0)}
                </span>
              </div>
            </div>
          </ChartCard>

          <ChartCard
            title="Số ngày thu tiền TB (DSO)"
            subtitle="3 tháng gần nhất"
          >
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <BarChart3 className="size-4" />
                  <span className="text-xs">DSO</span>
                </div>
                <p
                  className={`text-3xl font-bold ${(dso?.dso ?? 0) > 30 ? "text-red-600" : "text-green-600"}`}
                >
                  {dso?.dso ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">ngày</p>
              </div>
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <DollarSign className="size-4" />
                  <span className="text-xs">Phải thu</span>
                </div>
                <p className="text-3xl font-bold text-orange-600">
                  {formatChartCurrency(dso?.totalReceivables ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">VND</p>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Doanh thu TB/ngày
                </span>
                <span className="font-medium">
                  {formatCurrency(Math.round(dso?.avgDailyRevenue ?? 0))}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Đánh giá</span>
                <span
                  className={`font-medium ${(dso?.dso ?? 0) <= 15 ? "text-green-600" : (dso?.dso ?? 0) <= 30 ? "text-yellow-600" : "text-red-600"}`}
                >
                  {(dso?.dso ?? 0) <= 15
                    ? "Tốt"
                    : (dso?.dso ?? 0) <= 30
                      ? "Trung bình"
                      : "Cần cải thiện"}
                </span>
              </div>
            </div>
          </ChartCard>
        </div>

        {/* COGS Detail Table */}
        {cogsItems.length > 0 && (
          <ChartCard
            title="Chi tiết giá vốn theo sản phẩm"
            subtitle="Tháng hiện tại"
          >
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
                    <th className="text-right py-2 pr-4 font-medium">
                      Giá vốn/sp
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Tổng giá vốn
                    </th>
                    <th className="text-right py-2 font-medium">
                      % COGS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cogsItems.map((item, i) => (
                    <tr
                      key={item.productName}
                      className="border-b last:border-0"
                    >
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="py-2.5 pr-4 font-medium">
                        {item.productName}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {item.qtySold.toLocaleString("vi-VN")}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {formatCurrency(item.costPrice)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium text-orange-700">
                        {formatCurrency(item.totalCost)}
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="inline-block bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded text-xs font-medium">
                          {item.pctOfCogs}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
