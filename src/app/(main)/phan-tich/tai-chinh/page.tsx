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
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import {
  exportReportToExcel,
  buildReportTitleRows,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getFinanceKpis,
  getRevenueVsExpense,
  getExpenseBreakdown,
  getMonthlyProfit,
  getCashFlow,
} from "@/lib/services";
import type {
  MultiSeriesPoint,
  ChartPoint,
  CashFlowRow,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";

const EXPENSE_COLORS = ["#004AC6", "#ea580c", "#16a34a", "#9333ea", "#6b7280"];

// === Helpers ===

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// === Custom Tooltips ===

function RevenueExpenseTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm font-bold" style={{ color: p.color }}>
          {p.name}: {formatChartTooltipCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

function ExpenseTooltip({
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
      <p className="text-sm font-bold">{formatChartTooltipCurrency(payload[0].value)}</p>
    </div>
  );
}

function ProfitTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm font-bold ${value >= 0 ? "text-status-success" : "text-status-error"}`}>
        {value >= 0 ? "+" : ""}{formatChartTooltipCurrency(value)}
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

// === Types ===

interface FinanceKpis {
  revenue: number;
  prevRevenue: number;
  expense: number;
  prevExpense: number;
  profit: number;
  prevProfit: number;
  profitMargin: number;
  prevProfitMargin: number;
}

export default function TaiChinhPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches, tenant } = useAuth();
  const tenantName = tenant?.name;
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisYear", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<FinanceKpis | null>(null);
  const [revenueVsExpenseData, setRevenueVsExpenseData] = useState<MultiSeriesPoint[]>([]);
  const [expenseBreakdownData, setExpenseBreakdownData] = useState<{ name: string; value: number }[]>([]);
  const [monthlyProfitData, setMonthlyProfitData] = useState<ChartPoint[]>([]);
  const [cashFlowData, setCashFlowData] = useState<CashFlowRow[]>([]);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TÀI CHÍNH",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = {
        name: "KPI tài chính",
        titleRows: title,
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 28 },
          { label: "Kỳ hiện tại", key: "current", width: 18, format: "currency" },
          { label: "Kỳ trước", key: "prev", width: 18, format: "currency" },
        ],
        rows: [
          { metric: "Doanh thu", current: kpis?.revenue ?? 0, prev: kpis?.prevRevenue ?? 0 },
          { metric: "Chi phí", current: kpis?.expense ?? 0, prev: kpis?.prevExpense ?? 0 },
          { metric: "Lợi nhuận", current: kpis?.profit ?? 0, prev: kpis?.prevProfit ?? 0 },
          { metric: "Biên LN (%)", current: kpis?.profitMargin ?? 0, prev: kpis?.prevProfitMargin ?? 0 },
        ],
      };
      exportReportToExcel({ kind: "tai-chinh", mode: "view", range, branchName: branchLabel, sheets: [sheet] });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({ title: "Lỗi xuất Excel", description: err instanceof Error ? err.message : "", variant: "error" });
    }
  }, [kpis, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      // CEO 14/05 (research MISA): báo cáo Tài chính = P&L kế toán focused.
      // Bỏ Cash flow ra (đã có /luong-tien). Thêm disclaimer + signature
      // block (chuẩn báo cáo kế toán VN).

      const totalExpense = expenseBreakdownData.reduce(
        (s, e) => s + e.value,
        0,
      );

      // Sheet 0: Info + disclaimer
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO TÀI CHÍNH (P&L)",
        description:
          "Báo cáo kết quả kinh doanh — doanh thu, chi phí, lợi nhuận, biên lợi nhuận.",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
        disclaimer:
          "Báo cáo quản trị nội bộ — không thay thế Báo cáo tài chính theo Thông tư 200/133 do kế toán lập.",
      });

      const titleBase = {
        title: "BÁO CÁO TÀI CHÍNH (P&L)",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
      };

      // Sheet 1: P&L kỳ này — chuẩn lãi-lỗ
      const profit = (kpis?.revenue ?? 0) - (kpis?.expense ?? 0);
      const prevProfit = (kpis?.prevRevenue ?? 0) - (kpis?.prevExpense ?? 0);
      const plSheet: ExcelSheet = {
        name: "P&L kỳ này",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "BÁO CÁO KẾT QUẢ KINH DOANH",
        }),
        columns: [
          { label: "STT", key: "stt", width: 6, align: "center" },
          { label: "Chỉ tiêu", key: "metric", width: 36 },
          {
            label: "Kỳ này (VND)",
            key: "current",
            width: 20,
            format: "currency",
          },
          { label: "Kỳ trước (VND)", key: "prev", width: 20, format: "currency" },
          {
            label: "Chênh lệch (VND)",
            key: "diff",
            width: 20,
            format: "currency",
          },
          { label: "% thay đổi", key: "pct", width: 12, align: "right" },
        ],
        rows: [
          {
            stt: "1",
            metric: "Doanh thu bán hàng",
            current: kpis?.revenue ?? 0,
            prev: kpis?.prevRevenue ?? 0,
            diff: (kpis?.revenue ?? 0) - (kpis?.prevRevenue ?? 0),
            pct: pctChange(kpis?.revenue ?? 0, kpis?.prevRevenue ?? 0),
          },
          {
            stt: "2",
            metric: "Tổng chi phí hoạt động",
            current: kpis?.expense ?? 0,
            prev: kpis?.prevExpense ?? 0,
            diff: (kpis?.expense ?? 0) - (kpis?.prevExpense ?? 0),
            pct: pctChange(kpis?.expense ?? 0, kpis?.prevExpense ?? 0),
          },
          {
            stt: "3",
            metric: "LỢI NHUẬN TRƯỚC THUẾ",
            current: profit,
            prev: prevProfit,
            diff: profit - prevProfit,
            pct: pctChange(profit, prevProfit),
          },
          {
            stt: "4",
            metric: "Biên lợi nhuận (%)",
            current: kpis?.profitMargin ?? 0,
            prev: kpis?.prevProfitMargin ?? 0,
            diff:
              (kpis?.profitMargin ?? 0) - (kpis?.prevProfitMargin ?? 0),
            pct: "",
          },
        ],
        withSignature: true,
      };

      // Sheet 2: Cơ cấu chi phí
      const expenseSheet: ExcelSheet = {
        name: "Cơ cấu chi phí",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "CƠ CẤU CHI PHÍ THEO LOẠI",
        }),
        columns: [
          { label: "STT", key: "stt", width: 6, align: "center" },
          { label: "Loại chi phí", key: "name", width: 32 },
          { label: "Số tiền (VND)", key: "value", width: 22, format: "currency" },
          { label: "Tỷ trọng (%)", key: "share", width: 14, format: "percent" },
        ],
        rows: expenseBreakdownData.map((e, i) => ({
          stt: i + 1,
          name: e.name,
          value: e.value,
          share: totalExpense > 0 ? (e.value / totalExpense) * 100 : 0,
        })),
        footer: {
          stt: "",
          name: "TỔNG CHI PHÍ",
          value: totalExpense,
          share: 100,
        },
      };

      // Sheet 3: Doanh thu vs Chi phí 12 tháng
      const trendSheet: ExcelSheet = {
        name: "Trend 12 tháng",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "XU HƯỚNG DOANH THU VS CHI PHÍ 12 THÁNG",
        }),
        columns: [
          { label: "Tháng", key: "label", width: 14 },
          { label: "Doanh thu (VND)", key: "revenue", width: 20, format: "currency" },
          { label: "Chi phí (VND)", key: "expense", width: 20, format: "currency" },
          {
            label: "Lợi nhuận (VND)",
            key: "profit",
            width: 20,
            format: "currency",
          },
        ],
        rows: revenueVsExpenseData.map((p) => {
          const rev = Number(p.revenue ?? 0);
          const exp = Number(p.expense ?? 0);
          return {
            label: p.label,
            revenue: rev,
            expense: exp,
            profit: rev - exp,
          };
        }),
        footer: {
          label: "TỔNG 12 THÁNG",
          revenue: revenueVsExpenseData.reduce(
            (s, p) => s + Number(p.revenue ?? 0),
            0,
          ),
          expense: revenueVsExpenseData.reduce(
            (s, p) => s + Number(p.expense ?? 0),
            0,
          ),
          profit: revenueVsExpenseData.reduce(
            (s, p) => s + (Number(p.revenue ?? 0) - Number(p.expense ?? 0)),
            0,
          ),
        },
      };

      // Sheet 4: Lợi nhuận theo tháng
      const profitTrendSheet: ExcelSheet = {
        name: "LN theo tháng",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "LỢI NHUẬN THEO THÁNG",
        }),
        columns: [
          { label: "Tháng", key: "label", width: 14 },
          { label: "Lợi nhuận (VND)", key: "value", width: 20, format: "currency" },
        ],
        rows: monthlyProfitData.map((p) => ({
          label: p.label,
          value: p.value,
        })),
        footer: {
          label: "TỔNG",
          value: monthlyProfitData.reduce((s, p) => s + p.value, 0),
        },
      };

      exportReportToExcel({
        kind: "tai-chinh",
        mode: "full",
        range,
        branchName: branchLabel,
        tenantName,
        sheets: [
          infoSheet,
          plSheet,
          expenseSheet,
          trendSheet,
          profitTrendSheet,
        ],
      });
      toast({
        title: "Đã xuất báo cáo tài chính",
        description: "5 sheet: Info + P&L + Chi phí + Trend + LN tháng",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [
    kpis,
    revenueVsExpenseData,
    expenseBreakdownData,
    monthlyProfitData,
    range,
    branchLabel,
    tenantName,
    toast,
  ]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [kpiResult, revExpResult, expBkResult, profitResult, cashResult] =
        await Promise.all([
          getFinanceKpis(activeBranchId, range),
          getRevenueVsExpense(12, activeBranchId),
          getExpenseBreakdown(activeBranchId, range),
          getMonthlyProfit(12, activeBranchId),
          getCashFlow(6, activeBranchId),
        ]);
      setKpis(kpiResult);
      setRevenueVsExpenseData(revExpResult);
      setExpenseBreakdownData(expBkResult);
      setMonthlyProfitData(profitResult);
      setCashFlowData(cashResult);
    } catch (err) {
      console.error("Failed to fetch finance data:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady) return; // PERF F12: chờ AuthContext xong, tránh double-fire
    fetchData();
  }, [fetchData, isReady]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] items-center justify-center">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Đang tải dữ liệu...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      <ReportPageHeader
        title="Phân tích tài chính"
        subtitle="Tổng quan doanh thu, chi phí và lợi nhuận"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading}
      />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={kpis ? formatCurrency(kpis.revenue) : "—"}
            change={
              kpis
                ? `${pctChange(kpis.revenue, kpis.prevRevenue)} so với tháng trước`
                : ""
            }
            positive={kpis ? kpis.revenue >= kpis.prevRevenue : true}
            icon="trending_up"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Chi phí"
            value={kpis ? formatCurrency(kpis.expense) : "—"}
            change={
              kpis
                ? `${pctChange(kpis.expense, kpis.prevExpense)} so với tháng trước`
                : ""
            }
            positive={kpis ? kpis.expense <= kpis.prevExpense : false}
            icon="trending_down"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Lợi nhuận"
            value={kpis ? formatCurrency(kpis.profit) : "—"}
            change={
              kpis
                ? `${pctChange(kpis.profit, kpis.prevProfit)} so với tháng trước`
                : ""
            }
            positive={kpis ? kpis.profit >= kpis.prevProfit : true}
            icon="attach_money"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tỷ suất LN"
            value={kpis ? `${kpis.profitMargin}%` : "—"}
            change={
              kpis
                ? `${pctChange(kpis.profitMargin, kpis.prevProfitMargin)} so với tháng trước`
                : ""
            }
            positive={kpis ? kpis.profitMargin >= kpis.prevProfitMargin : true}
            icon="percent"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
        </div>

        {/* Revenue vs Expense line chart */}
        <ChartCard title="Doanh thu và Chi phí" subtitle="12 tháng gần nhất">
          {revenueVsExpenseData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Chưa có dữ liệu doanh thu và chi phí.
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart
                  data={revenueVsExpenseData}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
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
                  <Tooltip content={<RevenueExpenseTooltip />} />
                  <Legend
                    verticalAlign="top"
                    formatter={(value: string) => (
                      <span className="text-xs">{value}</span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#004AC6"
                    strokeWidth={2}
                    dot={{ fill: "#004AC6", r: 3 }}
                    activeDot={{ r: 5, fill: "#004AC6" }}
                    name="Doanh thu"
                  />
                  <Line
                    type="monotone"
                    dataKey="expense"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ fill: "#ef4444", r: 3 }}
                    activeDot={{ r: 5, fill: "#ef4444" }}
                    name="Chi phí"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Expense breakdown pie chart */}
          <ChartCard title="Cơ cấu chi phí" subtitle="Tháng hiện tại">
            {expenseBreakdownData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu chi phí.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={expenseBreakdownData}
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
                      {expenseBreakdownData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ExpenseTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      formatter={(value: string) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          {/* Monthly profit bar chart */}
          <ChartCard title="Lợi nhuận theo tháng" subtitle="12 tháng gần nhất">
            {monthlyProfitData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu lợi nhuận.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart
                    data={monthlyProfitData}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
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
                    <Tooltip content={<ProfitTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[6, 6, 0, 0]}
                      name="Lợi nhuận"
                    >
                      {monthlyProfitData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.value >= 0 ? "#16a34a" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Cash flow summary table */}
        <ChartCard title="Tổng hợp dòng tiền" subtitle="6 tháng gần nhất">
          {cashFlowData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Chưa có dữ liệu dòng tiền.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Tháng</th>
                    <th className="text-right py-2 pr-4 font-medium">Thu</th>
                    <th className="text-right py-2 pr-4 font-medium">Chi</th>
                    <th className="text-right py-2 font-medium">Tồn quỹ</th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlowData.map((item) => (
                    <tr key={item.month} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{item.month}</td>
                      <td className="py-3 pr-4 text-right text-status-success font-medium">
                        +{formatCurrency(item.thu)}
                      </td>
                      <td className="py-3 pr-4 text-right text-status-error font-medium">
                        -{formatCurrency(item.chi)}
                      </td>
                      <td className="py-3 text-right font-bold text-primary">
                        {formatCurrency(item.ton)}
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
