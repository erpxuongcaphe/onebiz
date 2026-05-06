"use client";

import { useState, useEffect, useCallback } from "react";
import {
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
import { useBranchFilter } from "@/lib/contexts";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getCustomerKpis,
  getNewCustomersMonthly,
  getCustomerSegments,
  getTopCustomersByRevenue,
  getTopDebtors,
} from "@/lib/services";
import type {
  ChartPoint,
  CustomerSegment,
  TopCustomer,
  TopDebtor,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";

const SEGMENT_COLORS = ["#f59e0b", "#004AC6", "#16a34a", "#8b5cf6"];

// === Custom Tooltips ===

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
      <p className="text-sm font-bold text-primary">
        {payload[0].value} khách mới
      </p>
    </div>
  );
}

function SegmentTooltip({
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
      <p className="text-sm font-bold">{payload[0].value} khách hàng</p>
    </div>
  );
}

function DebtTooltip({
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
      <p className="text-sm font-bold text-status-error">
        Nợ: {formatChartTooltipCurrency(payload[0].value)}
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
  if (percent < 0.08) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function KhachHangPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<{
    totalCustomers: number;
    newThisMonth: number;
    prevNewMonth: number;
    returningPct: number;
    totalDebt: number;
    prevTotalDebt: number;
  } | null>(null);
  const [newCustomersMonthly, setNewCustomersMonthly] = useState<ChartPoint[]>([]);
  const [customerSegments, setCustomerSegments] = useState<CustomerSegment[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [topDebtors, setTopDebtors] = useState<TopDebtor[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [kpiData, monthly, segments, customers, debtors] = await Promise.all([
        getCustomerKpis(activeBranchId, range),
        getNewCustomersMonthly(6, activeBranchId),
        getCustomerSegments(),
        getTopCustomersByRevenue(10, activeBranchId),
        getTopDebtors(),
      ]);
      setKpis(kpiData);
      setNewCustomersMonthly(monthly);
      setCustomerSegments(segments);
      setTopCustomers(customers);
      setTopDebtors(debtors);
    } catch (err) {
      console.error("Failed to fetch customer analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  const handleExportView = useCallback(() => {
    if (!kpis) return;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo khách hàng",
      range,
      branchName,
      generatedAt: new Date(),
    });
    exportReportToExcel({
      kind: "khach-hang",
      mode: "view",
      range,
      branchName,
      sheets: [
        {
          name: "Top khách hàng",
          titleRows,
          columns: [
            { label: "Hạng", key: "rank", width: 6, format: "number" },
            { label: "Khách hàng", key: "name", width: 28 },
            { label: "Số đơn", key: "orders", width: 10, format: "number" },
            { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
          ],
          rows: topCustomers.map((c) => ({
            rank: c.rank,
            name: c.name,
            orders: c.orders,
            revenue: c.revenue,
          })),
        },
      ],
    });
  }, [kpis, topCustomers, range, branchName]);

  const handleExportFull = useCallback(() => {
    if (!kpis) return;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo khách hàng — Đầy đủ",
      range,
      branchName,
      generatedAt: new Date(),
    });
    exportReportToExcel({
      kind: "khach-hang",
      mode: "full",
      range,
      branchName,
      sheets: [
        {
          name: "1. KPI",
          titleRows,
          columns: [
            { label: "Chỉ tiêu", key: "label", width: 28 },
            { label: "Giá trị", key: "value", width: 18, format: "currency" },
          ],
          rows: [
            { label: "Tổng khách hàng", value: kpis.totalCustomers },
            { label: "Khách mới tháng này", value: kpis.newThisMonth },
            { label: "Khách mới tháng trước", value: kpis.prevNewMonth },
            { label: "Tỷ lệ khách quay lại (%)", value: kpis.returningPct },
            { label: "Tổng nợ phải thu", value: kpis.totalDebt },
          ],
        },
        {
          name: "2. Top khách hàng",
          columns: [
            { label: "Hạng", key: "rank", width: 6, format: "number" },
            { label: "Khách hàng", key: "name", width: 28 },
            { label: "Số đơn", key: "orders", width: 10, format: "number" },
            { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
          ],
          rows: topCustomers.map((c) => ({
            rank: c.rank,
            name: c.name,
            orders: c.orders,
            revenue: c.revenue,
          })),
        },
        {
          name: "3. Top công nợ",
          columns: [
            { label: "Khách hàng", key: "name", width: 28 },
            { label: "Công nợ", key: "debt", width: 18, format: "currency" },
          ],
          rows: topDebtors.map((d) => ({ name: d.name, debt: d.debt })),
        },
        {
          name: "4. Khách mới theo tháng",
          columns: [
            { label: "Tháng", key: "label", width: 12 },
            { label: "Số khách mới", key: "value", width: 14, format: "number" },
          ],
          rows: newCustomersMonthly.map((p) => ({ label: p.label, value: p.value })),
        },
        {
          name: "5. Phân loại khách",
          columns: [
            { label: "Nhóm", key: "name", width: 18 },
            { label: "Số khách", key: "value", width: 12, format: "number" },
          ],
          rows: customerSegments.map((s) => ({ name: s.name, value: s.value })),
        },
      ],
    });
  }, [
    kpis,
    topCustomers,
    topDebtors,
    newCustomersMonthly,
    customerSegments,
    range,
    branchName,
  ]);

  const reportHeader = (
    <ReportPageHeader
      title="Báo cáo khách hàng"
      subtitle="Thống kê và phân loại khách hàng"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || !kpis}
    />
  );

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // KPI derived values
  const newMonthChange =
    kpis && kpis.prevNewMonth > 0
      ? Math.round(((kpis.newThisMonth - kpis.prevNewMonth) / kpis.prevNewMonth) * 100)
      : 0;
  const debtChange =
    kpis && kpis.prevTotalDebt > 0
      ? Math.round(((kpis.totalDebt - kpis.prevTotalDebt) / kpis.prevTotalDebt) * 100)
      : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng khách hàng"
            value={kpis ? String(kpis.totalCustomers) : "0"}
            change={kpis ? `+${kpis.newThisMonth} khách mới tháng này` : ""}
            positive
            icon="group"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Khách mới tháng"
            value={kpis ? String(kpis.newThisMonth) : "0"}
            change={newMonthChange !== 0 ? `${newMonthChange > 0 ? "+" : ""}${newMonthChange}% so với tháng trước` : "Không có dữ liệu tháng trước"}
            positive={newMonthChange >= 0}
            icon="person_add"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Khách quay lại"
            value={kpis ? `${kpis.returningPct}%` : "0%"}
            change=""
            positive
            icon="refresh"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Nợ phải thu"
            value={kpis ? formatCurrency(kpis.totalDebt) : formatCurrency(0)}
            change={debtChange !== 0 ? `${debtChange > 0 ? "+" : ""}${debtChange}% so với tháng trước` : ""}
            positive={debtChange <= 0}
            icon="credit_card"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* New customers per month */}
          <ChartCard title="Khách hàng mới theo tháng" subtitle="6 tháng gần nhất">
            {newCustomersMonthly.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={newCustomersMonthly}
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
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip content={<NewCustomerTooltip />} />
                    <Bar
                      dataKey="value"
                      fill="#004AC6"
                      radius={[6, 6, 0, 0]}
                      name="Khách mới"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Chưa có dữ liệu khách hàng mới
              </div>
            )}
          </ChartCard>

          {/* Customer segments */}
          <ChartCard title="Phân loại khách hàng" subtitle="Theo nhóm khách hàng">
            {customerSegments.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={customerSegments}
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
                      {customerSegments.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={SEGMENT_COLORS[index % SEGMENT_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<SegmentTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      formatter={(value: string) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Chưa có dữ liệu phân loại khách hàng
              </div>
            )}
          </ChartCard>
        </div>

        {/* Top 10 customers table */}
        <ChartCard title="Top 10 khách hàng theo doanh thu">
          {topCustomers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">#</th>
                    <th className="text-left py-2 pr-4 font-medium">Khách hàng</th>
                    <th className="text-right py-2 pr-4 font-medium">Số đơn</th>
                    <th className="text-right py-2 font-medium">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((item) => (
                    <tr key={item.rank} className="border-b last:border-0">
                      <td className="py-3 pr-4 text-muted-foreground">{item.rank}</td>
                      <td className="py-3 pr-4 font-medium">{item.name}</td>
                      <td className="py-3 pr-4 text-right">{item.orders}</td>
                      <td className="py-3 text-right font-medium text-primary">
                        {formatCurrency(item.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có dữ liệu khách hàng
            </div>
          )}
        </ChartCard>

        {/* Customer debt ranking */}
        <ChartCard title="Xếp hạng công nợ khách hàng" subtitle="Top 5 khách hàng có công nợ cao nhất">
          {topDebtors.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...topDebtors].reverse()}
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
                  <Tooltip content={<DebtTooltip />} />
                  <Bar
                    dataKey="debt"
                    fill="#ef4444"
                    radius={[0, 6, 6, 0]}
                    name="Công nợ"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              Chưa có dữ liệu công nợ
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
