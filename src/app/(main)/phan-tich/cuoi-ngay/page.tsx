"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { sortReportRows } from "@/lib/reports/table-sort";
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
  formatNumber,
} from "@/lib/format";
import { KpiCard, ChartCard } from "../_components";
import { useBranchFilter, useToast } from "@/lib/contexts";
import {
  getEndOfDayStats,
  getSalesRevenueByHour,
  getTodayTopProducts,
  getSalesReportDailyRows,
} from "@/lib/services";
import type { EndOfDayStats, ChartPoint, SalesReportDailyRow } from "@/lib/services/supabase/analytics";
import { buildSalesInvoiceDayLink, buildSalesReturnDayLink, buildSalesInvoiceRangeLink } from "@/lib/reports/sales-drilldown";
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
        {formatChartTooltipCurrency(d.value)} ({total > 0 ? formatNumber((d.value / total) * 100) : 0}%)
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
        Số lượng: {formatNumber(payload[0].value)}
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
    defaultViewMode: "table",
  });

  const [stats, setStats] = useState<EndOfDayStats | null>(null);
  const [revenueByHour, setRevenueByHour] = useState<ChartPoint[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyRows, setDailyRows] = useState<SalesReportDailyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const [tableSort, setTableSort] = useState<Record<string, { id: string; direction: "asc" | "desc" } | null>>({});
  const sortRows = useCallback(<T,>(rows: T[], table: string): T[] => {
    const sort = tableSort[table];
    return sort ? sortReportRows(rows, (row) => row[sort.id as keyof T], sort.direction) : rows;
  }, [tableSort]);

  const fetchData = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [statsData, hourData, productsData, dailyData] = await Promise.all([
        getEndOfDayStats(activeBranchId, range),
        getSalesRevenueByHour(activeBranchId, range),
        getTodayTopProducts(20, activeBranchId, range),
        getSalesReportDailyRows(activeBranchId, range),
      ]);
      if (request !== requestId.current) return;
      setStats(statsData);
      setRevenueByHour(hourData);
      setTopProducts(productsData);
      setDailyRows(dailyData);
    } catch (err) {
      if (request !== requestId.current) return;
      setStats(null);
      setDailyRows([]);
      setRevenueByHour([]);
      setTopProducts([]);
      setError(err instanceof Error ? err.message : "Không tải được báo cáo");
      console.error("Failed to fetch end-of-day data", err);
      toast({
        title: "Lỗi tải báo cáo cuối ngày",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [activeBranchId, range, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
    return () => { requestId.current += 1; };
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
          name: "Bán hàng theo ngày",
          titleRows,
          tablePreferenceKey: "report.cuoi-ngay.daily",
          columns: [
            { label: "Ngày", key: "date", width: 14 },
            { label: "Hóa đơn", key: "orderCount", width: 12, format: "number" },
            { label: "SL bán", key: "soldQty", width: 12, format: "number" },
            { label: "Giá trị hóa đơn", key: "grossRevenue", width: 18, format: "currency" },
            { label: "Trả trong kỳ", key: "returnAmount", width: 18, format: "currency" },
            { label: "Sau trả hàng", key: "netRevenue", width: 18, format: "currency" },
            { label: "Đã thu theo HĐ", key: "paid", width: 18, format: "currency" },
            { label: "Còn nợ theo HĐ", key: "debt", width: 18, format: "currency" },
          ],
          rows: sortRows(dailyRows, "daily").map((row) => ({ ...row })),
        },
        {
          name: "Doanh số theo PTTT",
          titleRows,
          tablePreferenceKey: "report.cuoi-ngay.payments",
          columns: [
            { label: "Phương thức trên HĐ", key: "method", width: 24 },
            { label: "Giá trị hóa đơn", key: "amount", width: 18, format: "currency" },
            { label: "Tỷ lệ %", key: "pct", width: 10, format: "number" },
          ],
          rows: sortRows([
            { method: "Tiền mặt", amount: stats.cashAmount, pct: totalRev > 0 ? (stats.cashAmount / totalRev) * 100 : 0 },
            { method: "Chuyển khoản", amount: stats.transferAmount, pct: totalRev > 0 ? (stats.transferAmount / totalRev) * 100 : 0 },
            { method: "Thẻ", amount: stats.cardAmount, pct: totalRev > 0 ? (stats.cardAmount / totalRev) * 100 : 0 },
            // P0-2 fix: thêm bucket Khác (hỗn hợp / ví điện tử) để tổng = totalRevenue
            { method: "Khác (Hỗn hợp / Ví)", amount: stats.otherAmount, pct: totalRev > 0 ? (stats.otherAmount / totalRev) * 100 : 0 },
          ], "payments"),
          footerLabel: "Tổng giá trị hóa đơn",
          footer: { amount: totalRev, pct: totalRev > 0 ? 100 : 0 },
        },
        {
          name: "Doanh thu theo giờ",
          tablePreferenceKey: "report.cuoi-ngay.hours",
          columns: [
            { label: "Giờ", key: "label", width: 12 },
            { label: "Doanh thu", key: "value", width: 18, format: "currency" },
            { label: "Tỷ trọng", key: "share", width: 12, format: "number" },
          ],
          rows: sortRows(revenueByHour.map((row) => ({ ...row, share: totalRev > 0 ? row.value / totalRev * 100 : 0 })), "hours"),
        },
        {
          name: "20 mặt hàng bán nhiều",
          tablePreferenceKey: "report.cuoi-ngay.products",
          columns: [{ label: "Mặt hàng", key: "name", width: 36 }, { label: "SL bán", key: "qty", width: 14, format: "number" }],
          rows: sortRows(topProducts, "products").map((row) => ({ ...row })),
        },
      ],
    });
  }, [stats, dailyRows, revenueByHour, topProducts, range, branchName, sortRows]);

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
        {
          name: "Bán hàng theo ngày",
          titleRows,
          columns: [
            { label: "Ngày", key: "date", width: 14 },
            { label: "Hóa đơn", key: "orderCount", width: 12, format: "number" },
            { label: "SL bán", key: "soldQty", width: 12, format: "number" },
            { label: "Giá trị hóa đơn", key: "grossRevenue", width: 18, format: "currency" },
            { label: "Trả trong kỳ", key: "returnAmount", width: 18, format: "currency" },
            { label: "Sau trả hàng", key: "netRevenue", width: 18, format: "currency" },
            { label: "Đã thu theo HĐ", key: "paid", width: 18, format: "currency" },
            { label: "Còn nợ theo HĐ", key: "debt", width: 18, format: "currency" },
          ],
          rows: dailyRows.map((row) => ({ ...row })),
        },
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
            { label: "Khác (Hỗn hợp / Ví)", value: stats.otherAmount },
            { label: "Trả hàng", value: stats.returnAmount },
            { label: "Giá trị sau trả hàng", value: stats.totalRevenue - stats.returnAmount },
            { label: "Doanh thu kỳ trước", value: stats.previousRevenue },
            { label: "Đơn kỳ trước", value: stats.previousOrders },
          ],
        },
        // Sheet 2 — Theo PTTT
        {
          name: "2. Theo phương thức TT",
          columns: [
            { label: "Phương thức trên HĐ", key: "method", width: 24 },
            { label: "Giá trị hóa đơn", key: "amount", width: 18, format: "currency" },
            { label: "Tỷ lệ %", key: "pct", width: 10, format: "number" },
          ],
          rows: [
            { method: "Tiền mặt", amount: stats.cashAmount, pct: totalRev > 0 ? (stats.cashAmount / totalRev) * 100 : 0 },
            { method: "Chuyển khoản", amount: stats.transferAmount, pct: totalRev > 0 ? (stats.transferAmount / totalRev) * 100 : 0 },
            { method: "Thẻ", amount: stats.cardAmount, pct: totalRev > 0 ? (stats.cardAmount / totalRev) * 100 : 0 },
            { method: "Khác (Hỗn hợp / Ví)", amount: stats.otherAmount, pct: totalRev > 0 ? (stats.otherAmount / totalRev) * 100 : 0 },
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
  }, [stats, dailyRows, revenueByHour, topProducts, range, branchName]);

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
        // P0-2 fix 11/06/2026: thêm Khác (mixed + ewallet) để tổng = totalRevenue
        {
          method: "Khác (Hỗn hợp / Ví)",
          amount: stats.otherAmount,
          pct: totalRev > 0 ? (stats.otherAmount / totalRev) * 100 : 0,
        },
      ]
    : [];

  const paymentColumns: DataTableColumn<PaymentRow>[] = [
    { label: "Phương thức trên HĐ", key: "method", align: "left" },
    {
      label: "Giá trị hóa đơn",
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

  const dailyColumns: DataTableColumn<SalesReportDailyRow>[] = [
    { label: "Ngày", key: "date", sticky: true, cell: (row) => <Link className="text-primary hover:underline" href={buildSalesInvoiceDayLink(row.date, activeBranchId)}>{row.date.split("-").reverse().join("/")}</Link> },
    { label: "Hóa đơn", key: "orderCount", align: "right", cell: (row) => formatNumber(row.orderCount) },
    { label: "SL bán", key: "soldQty", align: "right", cell: (row) => formatNumber(row.soldQty) },
    { label: "Giá trị hóa đơn", key: "grossRevenue", align: "right", cell: (row) => formatCurrency(row.grossRevenue) },
    { label: "Trả trong kỳ", key: "returnAmount", align: "right", cell: (row) => <Link className="text-primary hover:underline" href={buildSalesReturnDayLink(row.date, activeBranchId)}>{formatCurrency(row.returnAmount)}</Link> },
    { label: "Sau trả hàng", key: "netRevenue", align: "right", cell: (row) => formatCurrency(row.netRevenue) },
    { label: "Đã thu theo HĐ", key: "paid", align: "right", cell: (row) => formatCurrency(row.paid) },
    { label: "Còn nợ theo HĐ", key: "debt", align: "right", cell: (row) => formatCurrency(row.debt) },
  ];
  const hourRows = revenueByHour.map((row) => ({ ...row, share: totalRev > 0 ? row.value / totalRev * 100 : 0 }));

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
          <div role={error ? "alert" : undefined}>{error ?? "Không có dữ liệu cuối ngày."}
            {error && <button type="button" onClick={fetchData} className="ml-3 text-primary underline">Thử lại</button>}
          </div>
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
    { name: "Khác (Hỗn hợp / Ví)", value: stats.otherAmount, color: "#0891b2", total: totalRevenue },
  ];

  const hourChartData = revenueByHour.map((p) => ({
    hour: p.label,
    revenue: p.value,
  }));

  return (
    <div className="flex flex-col h-full">
      {header}

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        <nav className="flex flex-wrap gap-3 text-sm" aria-label="Chi tiết cuối ngày">
          <Link className="text-primary hover:underline" href={buildSalesInvoiceRangeLink(range.from, range.to, activeBranchId)}>Hóa đơn trong kỳ</Link>
          <Link className="text-primary hover:underline" href={`/phan-tich/khach-san-pham?${new URLSearchParams({ preset: "custom", from: range.from, to: range.to, view: "table", ...(activeBranchId ? { branch: activeBranchId } : {}) })}`}>Doanh thu khách hàng · mặt hàng</Link>
          <Link className="text-primary hover:underline" href={`/phan-tich/luong-tien?${new URLSearchParams({ preset: "custom", from: range.from, to: range.to, view: "table", ...(activeBranchId ? { branch: activeBranchId } : {}) })}`}>Thu chi trong kỳ</Link>
        </nav>
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
            label="Hóa đơn tiền mặt"
            value={formatCurrency(cashAmount) + "đ"}
            icon="payments"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Hóa đơn chuyển khoản"
            value={formatCurrency(transferAmount) + "đ"}
            icon="account_balance"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Hóa đơn thẻ"
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
                  <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
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
              <ChartCard title="Doanh số theo phương thức trên hóa đơn" subtitle="Tỷ lệ theo giá trị hóa đơn">
                {totalRevenue > 0 ? (
                  <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
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
            <ChartCard title="20 mặt hàng bán nhiều nhất" subtitle="Theo số lượng bán">
              {topProducts.length > 0 ? (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
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
          <div className="space-y-5">
            <section className="border border-border">
              <h2 className="border-b px-4 py-3 text-base font-semibold">Tổng kết bán hàng theo ngày</h2>
              <ReportDataTable columns={dailyColumns} rows={dailyRows} getRowKey={(row) => row.date} tablePreferenceKey="report.cuoi-ngay.daily" sortState={tableSort.daily ?? null} onSortChange={(sort) => setTableSort((current) => ({ ...current, daily: sort }))} subtotalLabel={`Giá trị sau trả hàng: ${formatCurrency(dailyRows.reduce((sum, row) => sum + row.netRevenue, 0))}đ`} />
            </section>
            <section className="border border-border">
              <h2 className="border-b px-4 py-3 text-base font-semibold">Doanh số theo phương thức trên hóa đơn</h2>
            <ReportDataTable<PaymentRow>
              columns={paymentColumns}
              tablePreferenceKey="report.cuoi-ngay.payments"
              sortState={tableSort.payments ?? null}
              onSortChange={(sort) => setTableSort((current) => ({ ...current, payments: sort }))}
              rows={paymentRows}
              getRowKey={(r) => r.method}
              subtotalLabel={`Tổng cộng: ${formatCurrency(totalRev)}đ`}
              emptyState="Chưa có giao dịch trong kỳ"
            />
            </section>
            <section className="border border-border">
              <h2 className="border-b px-4 py-3 text-base font-semibold">Doanh thu theo giờ</h2>
              <ReportDataTable columns={[
                { label: "Giờ", key: "label" },
                { label: "Doanh thu", key: "value", align: "right", cell: (row) => formatCurrency(row.value) },
                { label: "Tỷ trọng", key: "share", align: "right", cell: (row) => `${row.share.toFixed(1)}%` },
              ]} rows={hourRows} getRowKey={(row) => row.label} tablePreferenceKey="report.cuoi-ngay.hours" sortState={tableSort.hours ?? null} onSortChange={(sort) => setTableSort((current) => ({ ...current, hours: sort }))} />
            </section>
            <section className="border border-border">
              <h2 className="border-b px-4 py-3 text-base font-semibold">20 mặt hàng bán nhiều nhất</h2>
              <ReportDataTable columns={[
                { label: "Mặt hàng", key: "name" },
                { label: "SL bán trước trả", key: "qty", align: "right", cell: (row) => formatNumber(row.qty) },
              ]} rows={topProducts} getRowKey={(row, index) => `${row.name}-${index}`} tablePreferenceKey="report.cuoi-ngay.products" sortState={tableSort.products ?? null} onSortChange={(sort) => setTableSort((current) => ({ ...current, products: sort }))} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
