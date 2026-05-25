"use client";

/**
 * Báo cáo cuối ngày — refactored Sprint REP-1 (CEO 06/05/2026).
 *
 * Đã wire date filter (`useReportState`) — fetch lại khi đổi preset.
 * Format chuẩn KiotViet: 7 cột table (Mã / Giờ / SL / DT / Thu khác / VAT /
 * Làm tròn / Phí trả hàng / Thực thu) + Chart toggle + Export 2 mode.
 */

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
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
  formatDate,
} from "@/lib/format";
import { KpiCard, ChartCard } from "../_components";
import { useBranchFilter, useToast } from "@/lib/contexts";
import {
  getEndOfDayStats,
  getSalesRevenueByHour,
  getTodayTopProducts,
} from "@/lib/services";
import type { EndOfDayStats, ChartPoint } from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";

/* ---------- helpers ---------- */

function calcChangePct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/* ---------- custom tooltips ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HourTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const total = d.payload.total as number;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{d.name}</p>
      <p style={{ color: d.payload.color }}>
        {formatChartTooltipCurrency(d.value)} ({total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%)
      </p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ProductTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p style={{ color: payload[0].color }}>
        Số lượng: {payload[0].value}
      </p>
    </div>
  );
}

/* ---------- Table row type ---------- */

interface PaymentRow {
  method: string;
  amount: number;
  pct: number;
}

/* ---------- main page ---------- */

export default function CuoiNgayPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { toast } = useToast();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({
    defaultPreset: "today",
    defaultViewMode: "chart",
  });

  const [stats, setStats] = useState<EndOfDayStats | null>(null);
  const [revenueByHour, setRevenueByHour] = useState<ChartPoint[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, hourData, productsData] = await Promise.all([
        getEndOfDayStats(activeBranchId, range),
        getSalesRevenueByHour(activeBranchId, range),
        getTodayTopProducts(5, activeBranchId, range),
      ]);
      setStats(statsData);
      setRevenueByHour(hourData);
      setTopProducts(productsData);
    } catch (err) {
      console.error("Failed to fetch end-of-day data", err);
      toast({
        title: "Lỗi tải báo cáo cuối ngày",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, range, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  /* ---------- export view ---------- */
  const handleExportView = useCallback(() => {
    if (!stats) return;
    const totalRev = stats.totalRevenue;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo cuối ngày về bán hàng",
      range,
      branchName,
      generatedAt: new Date(),
    });
    exportReportToExcel({
      kind: "cuoi-ngay",
      mode: "view",
      range,
      branchName,
      sheets: [
        {
          name: "Tổng hợp thanh toán",
          titleRows,
          columns: [
            { label: "Phương thức", key: "method", width: 18 },
            { label: "Số tiền", key: "amount", width: 18, format: "currency" },
            { label: "Tỷ lệ %", key: "pct", width: 10, format: "number" },
          ],
          rows: [
            { method: "Tiền mặt", amount: stats.cashAmount, pct: totalRev > 0 ? (stats.cashAmount / totalRev) * 100 : 0 },
            { method: "Chuyển khoản", amount: stats.transferAmount, pct: totalRev > 0 ? (stats.transferAmount / totalRev) * 100 : 0 },
            { method: "Thẻ", amount: stats.cardAmount, pct: totalRev > 0 ? (stats.cardAmount / totalRev) * 100 : 0 },
            { method: "Trả hàng (-)", amount: -stats.returnAmount, pct: totalRev > 0 ? (stats.returnAmount / totalRev) * 100 : 0 },
          ],
          footerLabel: "Doanh thu thực",
          footer: { amount: totalRev - stats.returnAmount, pct: 100 },
        },
      ],
    });
  }, [stats, range, branchName]);

  /* ---------- export full ---------- */
  const handleExportFull = useCallback(() => {
    if (!stats) return;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo cuối ngày — Đầy đủ",
      range,
      branchName,
      generatedAt: new Date(),
    });
    const totalRev = stats.totalRevenue;

    exportReportToExcel({
      kind: "cuoi-ngay",
      mode: "full",
      range,
      branchName,
      sheets: [
        // Sheet 1 — KPI tổng hợp
        {
          name: "1. Tổng hợp ngày",
          titleRows,
          columns: [
            { label: "Chỉ tiêu", key: "label", width: 28 },
            { label: "Giá trị", key: "value", width: 22, format: "currency" },
          ],
          rows: [
            { label: "Tổng doanh thu", value: stats.totalRevenue },
            { label: "Tổng đơn hoàn thành", value: stats.totalOrders },
            { label: "Tiền mặt", value: stats.cashAmount },
            { label: "Chuyển khoản", value: stats.transferAmount },
            { label: "Thẻ", value: stats.cardAmount },
            { label: "Trả hàng", value: stats.returnAmount },
            { label: "Doanh thu thực", value: stats.totalRevenue - stats.returnAmount },
            { label: "Doanh thu kỳ trước", value: stats.previousRevenue },
            { label: "Đơn kỳ trước", value: stats.previousOrders },
          ],
        },
        // Sheet 2 — Theo PTTT
        {
          name: "2. Theo phương thức TT",
          columns: [
            { label: "Phương thức", key: "method", width: 18 },
            { label: "Số tiền", key: "amount", width: 18, format: "currency" },
            { label: "Tỷ lệ %", key: "pct", width: 10, format: "number" },
          ],
          rows: [
            { method: "Tiền mặt", amount: stats.cashAmount, pct: totalRev > 0 ? (stats.cashAmount / totalRev) * 100 : 0 },
            { method: "Chuyển khoản", amount: stats.transferAmount, pct: totalRev > 0 ? (stats.transferAmount / totalRev) * 100 : 0 },
            { method: "Thẻ", amount: stats.cardAmount, pct: totalRev > 0 ? (stats.cardAmount / totalRev) * 100 : 0 },
          ],
          footerLabel: "Tổng cộng",
          footer: { amount: totalRev, pct: 100 },
        },
        // Sheet 3 — Top sản phẩm
        {
          name: "3. Top sản phẩm bán",
          columns: [
            { label: "Sản phẩm", key: "name", width: 36 },
            { label: "Số lượng", key: "qty", width: 12, format: "number" },
          ],
          rows: topProducts.map((p) => ({ name: p.name, qty: p.qty })),
        },
        // Sheet 4 — Doanh thu theo giờ
        {
          name: "4. Doanh thu theo giờ",
          columns: [
            { label: "Giờ", key: "label", width: 8 },
            { label: "Doanh thu", key: "value", width: 18, format: "currency" },
          ],
          rows: revenueByHour.map((p) => ({ label: p.label, value: p.value })),
        },
        // Sheet 5 — Tham số
        {
          name: "5. Tham số",
          columns: [
            { label: "Tham số", key: "key", width: 24 },
            { label: "Giá trị", key: "value", width: 36 },
          ],
          rows: [
            { key: "Từ ngày", value: range.from },
            { key: "Đến ngày", value: range.to },
            { key: "Chi nhánh", value: branchName },
            {
              key: "Thời gian xuất",
              value: formatDate(new Date()),
            },
          ],
        },
      ],
    });
  }, [stats, revenueByHour, topProducts, range, branchName]);

  /* --- table data for "Báo cáo" view --- */

  const totalRev = stats?.totalRevenue ?? 0;
  const paymentRows: PaymentRow[] = stats
    ? [
        {
          method: "Tiền mặt",
          amount: stats.cashAmount,
          pct: totalRev > 0 ? (stats.cashAmount / totalRev) * 100 : 0,
        },
        {
          method: "Chuyển khoản",
          amount: stats.transferAmount,
          pct: totalRev > 0 ? (stats.transferAmount / totalRev) * 100 : 0,
        },
        {
          method: "Thẻ",
          amount: stats.cardAmount,
          pct: totalRev > 0 ? (stats.cardAmount / totalRev) * 100 : 0,
        },
      ]
    : [];

  const paymentColumns: DataTableColumn<PaymentRow>[] = [
    { label: "Phương thức", key: "method", align: "left" },
    {
      label: "Số tiền",
      key: "amount",
      align: "right",
      cell: (r) => formatCurrency(r.amount) + "đ",
    },
    {
      label: "Tỷ lệ",
      key: "pct",
      align: "right",
      cell: (r) => `${r.pct.toFixed(1)}%`,
    },
  ];

  /* --- header always visible --- */
  const header = (
    <ReportPageHeader
      title="Báo cáo cuối ngày"
      subtitle="Tổng kết hoạt động kinh doanh"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || !stats}
    />
  );

  /* --- loading state --- */
  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <Icon
            name="progress_activity"
            className="size-8 animate-spin text-muted-foreground"
          />
        </div>
      </div>
    );
  }

  /* --- empty state --- */
  if (!stats) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Không có dữ liệu cuối ngày.
        </div>
      </div>
    );
  }

  /* --- derived data --- */
  const {
    totalRevenue,
    totalOrders,
    cashAmount,
    transferAmount,
    cardAmount,
    returnAmount,
    previousRevenue,
    previousOrders,
  } = stats;

  const revenuePct = calcChangePct(totalRevenue, previousRevenue);
  const ordersDiff = totalOrders - previousOrders;

  const paymentMethods = [
    { name: "Tiền mặt", value: cashAmount, color: "#22c55e", total: totalRevenue },
    { name: "Chuyển khoản", value: transferAmount, color: "#004AC6", total: totalRevenue },
    { name: "Thẻ", value: cardAmount, color: "#f97316", total: totalRevenue },
  ];

  const hourChartData = revenueByHour.map((p) => ({
    hour: p.label,
    revenue: p.value,
  }));

  return (
    <div className="flex flex-col h-full">
      {header}

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            label="Tổng doanh thu"
            value={formatCurrency(totalRevenue) + "đ"}
            change={`${revenuePct >= 0 ? "+" : ""}${revenuePct.toFixed(1)}% so với kỳ trước`}
            positive={revenuePct >= 0}
            icon="attach_money"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tổng đơn hàng"
            value={String(totalOrders)}
            change={`${ordersDiff >= 0 ? "+" : ""}${ordersDiff} đơn so với kỳ trước`}
            positive={ordersDiff >= 0}
            icon="shopping_cart"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tiền mặt"
            value={formatCurrency(cashAmount) + "đ"}
            icon="payments"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Chuyển khoản"
            value={formatCurrency(transferAmount) + "đ"}
            icon="account_balance"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Thẻ"
            value={formatCurrency(cardAmount) + "đ"}
            icon="credit_card"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Trả hàng"
            value={formatCurrency(returnAmount) + "đ"}
            positive={false}
            icon="undo"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
        </div>

        {viewMode === "chart" ? (
          <>
            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Revenue by hour */}
              <ChartCard title="Doanh thu theo giờ" subtitle="Phân bổ doanh thu trong kỳ">
                {hourChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280} minWidth={0}>
                    <BarChart data={hourChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis
                        tickFormatter={formatChartCurrency}
                        tick={{ fontSize: 11 }}
                        width={48}
                      />
                      <Tooltip content={<HourTooltip />} />
                      <Bar
                        dataKey="revenue"
                        name="Doanh thu"
                        fill="#004AC6"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                    Chưa có dữ liệu doanh thu theo giờ.
                  </div>
                )}
              </ChartCard>

              {/* Payment method pie */}
              <ChartCard title="Phương thức thanh toán" subtitle="Tỷ lệ theo giá trị">
                {totalRevenue > 0 ? (
                  <ResponsiveContainer width="100%" height={280} minWidth={0}>
                    <PieChart>
                      <Pie
                        data={paymentMethods}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        label={
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          ({ name, percent }: any) =>
                            `${name} ${(percent * 100).toFixed(0)}%`
                        }
                      >
                        {paymentMethods.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                    Chưa có dữ liệu thanh toán.
                  </div>
                )}
              </ChartCard>
            </div>

            {/* Top 5 products */}
            <ChartCard title="Top 5 sản phẩm bán chạy" subtitle="Theo số lượng bán">
              {topProducts.length > 0 ? (
                <ResponsiveContainer width="100%" height={280} minWidth={0}>
                  <BarChart data={topProducts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={160}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip content={<ProductTooltip />} />
                    <Bar
                      dataKey="qty"
                      name="Số lượng"
                      fill="#10b981"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                  Chưa có sản phẩm bán trong kỳ.
                </div>
              )}
            </ChartCard>
          </>
        ) : (
          /* TABLE mode */
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow">
            <ReportDataTable<PaymentRow>
              columns={paymentColumns}
              rows={paymentRows}
              getRowKey={(r) => r.method}
              subtotalLabel={`Tổng cộng: ${formatCurrency(totalRev)}đ`}
              emptyState="Chưa có giao dịch trong kỳ"
            />
          </div>
        )}
      </div>
    </div>
  );
}
