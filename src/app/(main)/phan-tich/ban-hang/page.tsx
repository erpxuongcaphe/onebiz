"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { useBranchFilter, useToast } from "@/lib/contexts";
import {
  formatCurrency,
  formatNumber,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getSalesInvoiceExportRows,
  getSalesReportDailyRows,
  getSalesReportInvoiceDetailPage,
  getSalesReportSummary,
} from "@/lib/services";
import type {
  MonthlyRevenuePoint,
  ChartPoint,
  SalesKpis,
  SalesReportDailyRow,
  SalesReportInvoiceDetailRow,
  TopInvoice,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";
import {
  ReportPageHeader,
  ReportDataTable,
  ReportTableFrame,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";
import {
  buildSalesOverviewRows,
  getSalesOverviewInsights,
  SALES_OVERVIEW_METRICS,
  type SalesOverviewMetric,
} from "@/lib/reports/sales-overview";

// === Helpers ===

function calcChangePct(
  current: number,
  previous: number,
): { text: string; positive: boolean } {
  if (previous === 0)
    return { text: current > 0 ? "+100%" : "0%", positive: current >= 0 };
  const pct = ((current - previous) / previous) * 100;
  return {
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    positive: pct >= 0,
  };
}

const DAY_COLORS = [
  "#64748b",
  "#64748b",
  "#64748b",
  "#64748b",
  "#004AC6",
  "#16a34a",
  "#16a34a",
];

type SalesTableMode = "daily" | "invoices";

function formatReportDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? [day, month, year].join("/") : value;
}

function formatReportDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

// === Custom Tooltips ===

function SalesOverviewTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  metric: SalesOverviewMetric;
}) {
  if (!active || !payload?.length) return null;
  const selectedMetric = SALES_OVERVIEW_METRICS[metric];
  const value = payload[0].value;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">Ngày {label}</p>
      <p className="text-sm font-bold text-primary">
        {metric === "netRevenue"
          ? formatChartTooltipCurrency(value)
          : `${formatNumber(value)} ${metric === "orderCount" ? "đơn" : "món"}`}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {selectedMetric.label}
      </p>
    </div>
  );
}

function DayOfWeekTooltip({
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
      <p className="text-sm font-bold text-status-success">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function HourlyTooltip({
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
      <p className="text-sm font-bold text-status-info">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

// === Page ===

export default function BanHangPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { toast } = useToast();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [kpis, setKpis] = useState<SalesKpis | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [revenueByWeekday, setRevenueByWeekday] = useState<ChartPoint[]>([]);
  const [revenueByHour, setRevenueByHour] = useState<ChartPoint[]>([]);
  const [topInvoicesList, setTopInvoicesList] = useState<TopInvoice[]>([]);
  const [tableMode, setTableMode] = useState<SalesTableMode>("daily");
  const [overviewMetric, setOverviewMetric] =
    useState<SalesOverviewMetric>("netRevenue");
  const [dailyRows, setDailyRows] = useState<SalesReportDailyRow[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<SalesReportInvoiceDetailRow[]>([]);
  const [invoiceRowsHasMore, setInvoiceRowsHasMore] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const dailyRequestIdRef = useRef(0);
  const invoiceRequestIdRef = useRef(0);
  // These derive from state even while the report is loading. They must remain
  // before all early returns so the component always calls hooks in one order.
  const overviewRows = useMemo(
    () => buildSalesOverviewRows(dailyRows, overviewMetric),
    [dailyRows, overviewMetric],
  );
  const overviewInsights = useMemo(
    () => getSalesOverviewInsights(dailyRows, revenueByHour, overviewMetric),
    [dailyRows, revenueByHour, overviewMetric],
  );

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const summary = await getSalesReportSummary(activeBranchId, range);
      if (requestId !== requestIdRef.current) return;
      setKpis(summary.kpis);
      setDailyRevenue(summary.dailyRevenue);
      setRevenueByWeekday(summary.revenueByWeekday);
      setRevenueByHour(summary.revenueByHour);
      setTopInvoicesList(summary.topInvoices);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Failed to fetch sales analytics:", err);
      toast({
        title: "Lỗi tải báo cáo bán hàng",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, range, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const fetchDailyRows = useCallback(async () => {
    const requestId = ++dailyRequestIdRef.current;
    setDailyLoading(true);
    setDailyError(null);
    try {
      const rows = await getSalesReportDailyRows(activeBranchId, range);
      if (requestId !== dailyRequestIdRef.current) return;
      setDailyRows(rows);
    } catch (error) {
      if (requestId !== dailyRequestIdRef.current) return;
      const message =
        error instanceof Error ? error.message : "Vui long thu lai.";
      setDailyError(message);
      toast({
        title: "Loi tai bao cao theo ngay",
        description: message,
        variant: "error",
      });
    } finally {
      if (requestId === dailyRequestIdRef.current) setDailyLoading(false);
    }
  }, [activeBranchId, range, toast]);

  const fetchInvoiceRows = useCallback(async (offset: number) => {
    const requestId = ++invoiceRequestIdRef.current;
    setInvoiceLoading(true);
    setInvoiceError(null);
    try {
      const page = await getSalesReportInvoiceDetailPage(
        activeBranchId,
        range,
        offset,
      );
      if (requestId !== invoiceRequestIdRef.current) return;
      setInvoiceRows((current) =>
        offset === 0 ? page.rows : [...current, ...page.rows],
      );
      setInvoiceRowsHasMore(page.hasMore);
    } catch (error) {
      if (requestId !== invoiceRequestIdRef.current) return;
      const message =
        error instanceof Error ? error.message : "Vui long thu lai.";
      setInvoiceError(message);
      toast({
        title: "Loi tai bao cao theo hoa don",
        description: message,
        variant: "error",
      });
    } finally {
      if (requestId === invoiceRequestIdRef.current) setInvoiceLoading(false);
    }
  }, [activeBranchId, range, toast]);

  // Daily rows power both the detailed table and the operational chart. Loading
  // once per range keeps the two modes consistent instead of showing two
  // different revenue definitions.
  useEffect(() => {
    if (!isReady) return;
    fetchDailyRows();
  }, [fetchDailyRows, isReady]);

  useEffect(() => {
    if (!isReady || viewMode !== "table" || tableMode !== "invoices") return;
    fetchInvoiceRows(0);
  }, [fetchInvoiceRows, isReady, tableMode, viewMode]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  // ===== Excel exports =====
  const handleExportView = useCallback(async () => {
    if (!kpis) return;
    if (viewMode === "table") {
      const tableTitleRows = buildReportTitleRows({
        title:
          tableMode === "daily"
            ? "Báo cáo bán hàng theo ngày"
            : "Báo cáo bán hàng theo hóa đơn",
        range,
        branchName,
        generatedAt: new Date(),
      });
      const tableSheet =
        tableMode === "daily"
          ? {
              name: "Theo ngày",
              titleRows: tableTitleRows,
              tablePreferenceKey: "report.ban-hang.daily-revenue",
              columns: [
                { label: "Ngày", key: "date", width: 14 },
                { label: "Đơn", key: "orderCount", width: 10 },
                { label: "SL bán", key: "soldQty", width: 12 },
                { label: "Bán gộp", key: "grossRevenue", width: 18, format: "currency" as const },
                { label: "Trả trong ngày", key: "returnAmount", width: 18, format: "currency" as const },
                { label: "Doanh thu thuần", key: "netRevenue", width: 18, format: "currency" as const },
                { label: "Đã thu", key: "paid", width: 18, format: "currency" as const },
                { label: "Còn nợ", key: "debt", width: 18, format: "currency" as const },
              ],
              rows: dailyRows.map((row) => ({
                date: formatReportDate(row.date),
                orderCount: row.orderCount,
                soldQty: row.soldQty,
                grossRevenue: row.grossRevenue,
                returnAmount: row.returnAmount,
                netRevenue: row.netRevenue,
                paid: row.paid,
                debt: row.debt,
              })),
              footerLabel: "Tổng cộng",
              footer: {
                grossRevenue: dailyRows.reduce((sum, row) => sum + row.grossRevenue, 0),
                returnAmount: dailyRows.reduce((sum, row) => sum + row.returnAmount, 0),
                netRevenue: dailyRows.reduce((sum, row) => sum + row.netRevenue, 0),
                paid: dailyRows.reduce((sum, row) => sum + row.paid, 0),
                debt: dailyRows.reduce((sum, row) => sum + row.debt, 0),
              },
            }
          : {
              name: "Theo hóa đơn",
              titleRows: tableTitleRows,
              tablePreferenceKey: "report.ban-hang.invoice-drilldown",
              columns: [
                { label: "Mã hóa đơn", key: "code", width: 16 },
                { label: "Thời gian", key: "createdAt", width: 20 },
                { label: "Khách hàng", key: "customerName", width: 28 },
                { label: "Dòng", key: "itemCount", width: 10 },
                { label: "SL bán", key: "soldQty", width: 12 },
                { label: "Tổng đơn", key: "total", width: 18, format: "currency" as const },
                { label: "Trả trong kỳ", key: "returnAmount", width: 18, format: "currency" as const },
                { label: "Thuần", key: "netAmount", width: 18, format: "currency" as const },
                { label: "Đã thu", key: "paid", width: 18, format: "currency" as const },
                { label: "Còn nợ", key: "debt", width: 18, format: "currency" as const },
              ],
              rows: invoiceRows.map((row) => ({
                code: row.code,
                createdAt: formatReportDateTime(row.createdAt),
                customerName: row.customerName,
                itemCount: row.itemCount,
                soldQty: row.soldQty,
                total: row.total,
                returnAmount: row.returnAmount,
                netAmount: row.netAmount,
                paid: row.paid,
                debt: row.debt,
              })),
              footerLabel: "Tổng các hóa đơn đã tải",
              footer: {
                total: invoiceRows.reduce((sum, row) => sum + row.total, 0),
                returnAmount: invoiceRows.reduce((sum, row) => sum + row.returnAmount, 0),
                netAmount: invoiceRows.reduce((sum, row) => sum + row.netAmount, 0),
                paid: invoiceRows.reduce((sum, row) => sum + row.paid, 0),
                debt: invoiceRows.reduce((sum, row) => sum + row.debt, 0),
              },
            };
      await exportReportToExcel({
        kind: "ban-hang",
        mode: "view",
        range,
        branchName,
        sheets: [tableSheet],
      });
      return;
    }
    const titleRows = buildReportTitleRows({
      title: "Báo cáo bán hàng",
      range,
      branchName,
      generatedAt: new Date(),
    });
    await exportReportToExcel({
      kind: "ban-hang",
      mode: "view",
      range,
      branchName,
      sheets: [
        {
          name: "KPI bán hàng",
          titleRows,
          columns: [
            { label: "Chỉ tiêu", key: "label", width: 28 },
            { label: "Kỳ này", key: "current", width: 18, format: "currency" },
            { label: "Kỳ trước", key: "previous", width: 18, format: "currency" },
          ],
          rows: [
            { label: "Doanh thu hàng hóa", current: kpis.goodsRevenue, previous: kpis.prevGoodsRevenue },
            { label: "Phí giao hàng thu hộ", current: kpis.deliveryFee, previous: kpis.prevDeliveryFee },
              { label: "(-) Giá trị trả hàng", current: kpis.returnAmount, previous: kpis.prevReturnAmount },
            { label: "Tổng thu (gồm phí giao)", current: kpis.netRevenue, previous: kpis.prevNetRevenue },
            { label: "Số lượng bán", current: kpis.soldQty, previous: kpis.prevSoldQty },
            { label: "Giá trị trung bình mỗi đơn", current: kpis.avgOrderValue, previous: kpis.prevAvgOrderValue },
            { label: "Tỷ lệ trả hàng (%)", current: kpis.returnRate, previous: kpis.prevReturnRate },
          ],
        },
      ],
    });
  }, [branchName, dailyRows, invoiceRows, kpis, range, tableMode, viewMode]);

  const handleExportFull = useCallback(async () => {
    if (!kpis) return;
    setExporting(true);
    try {
      const invoiceRows = await getSalesInvoiceExportRows(activeBranchId, range);
      const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
      const titleRows = buildReportTitleRows({
        title: "Báo cáo bán hàng — Đầy đủ",
        range,
        branchName,
        generatedAt: new Date(),
      });
      await exportReportToExcel({
        kind: "ban-hang",
        mode: "full",
        range,
        branchName,
        reportTitle: "Báo cáo bán hàng",
        description:
          "Doanh thu, xu hướng bán hàng và toàn bộ hóa đơn hoàn tất trong phạm vi đã chọn.",
        disclaimer:
          "Doanh thu lấy từ hóa đơn hoàn tất; phí giao hàng thu hộ được trình bày riêng khỏi doanh thu hàng hóa.",
        sheets: [
          {
            name: "1. KPI",
            titleRows,
            columns: [
              { label: "Chỉ tiêu", key: "label", width: 28 },
              { label: "Kỳ này", key: "current", width: 18, format: "currency" },
              { label: "Kỳ trước", key: "previous", width: 18, format: "currency" },
            ],
            rows: [
              { label: "Doanh thu hàng hóa", current: kpis.goodsRevenue, previous: kpis.prevGoodsRevenue },
              { label: "Phí giao hàng thu hộ", current: kpis.deliveryFee, previous: kpis.prevDeliveryFee },
              { label: "(-) Giá trị trả hàng", current: kpis.returnAmount, previous: kpis.prevReturnAmount },
              { label: "Tổng thu (gồm phí giao)", current: kpis.netRevenue, previous: kpis.prevNetRevenue },
              { label: "Số lượng bán", current: kpis.soldQty, previous: kpis.prevSoldQty },
              { label: "Giá trị trung bình mỗi đơn", current: kpis.avgOrderValue, previous: kpis.prevAvgOrderValue },
              { label: "Tỷ lệ trả hàng (%)", current: kpis.returnRate, previous: kpis.prevReturnRate },
            ],
          },
          {
            name: "2. Theo ngày",
            columns: [
              { label: "Ngày", key: "date", width: 12 },
              { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
            ],
            rows: dailyRevenue.map((row) => ({ date: row.date, revenue: row.revenue })),
          },
          {
            name: "3. Theo thứ",
            columns: [
              { label: "Thứ", key: "label", width: 14 },
              { label: "Doanh thu", key: "value", width: 18, format: "currency" },
            ],
            rows: revenueByWeekday.map((row) => ({ label: row.label, value: row.value })),
          },
          {
            name: "4. Theo giờ",
            columns: [
              { label: "Giờ", key: "label", width: 8 },
              { label: "Doanh thu", key: "value", width: 18, format: "currency" },
            ],
            rows: revenueByHour.map((row) => ({ label: row.label, value: row.value })),
          },
          {
            name: "5. Top hóa đơn",
            columns: [
              { label: "Mã HĐ", key: "code", width: 14 },
              { label: "Khách hàng", key: "customer", width: 28 },
              { label: "Giá trị", key: "value", width: 18, format: "currency" },
              { label: "Ngày", key: "date", width: 14 },
            ],
            rows: topInvoicesList.map((invoice) => ({
              code: invoice.code,
              customer: invoice.customer,
              value: invoice.value,
              date: invoice.date,
            })),
          },
          {
            name: "6. Toàn bộ hóa đơn",
            columns: [
              { label: "Mã HĐ", key: "code", width: 16 },
              { label: "Thời gian", key: "createdAt", width: 20, format: "date" },
              { label: "Chi nhánh", key: "branch", width: 24 },
              { label: "Khách hàng", key: "customer", width: 28 },
              { label: "Tiền hàng", key: "subtotal", width: 18, format: "currency" },
              { label: "Giảm giá", key: "discount", width: 16, format: "currency" },
              { label: "Phí giao", key: "deliveryFee", width: 16, format: "currency" },
              { label: "Tổng thanh toán", key: "total", width: 18, format: "currency" },
              { label: "Đã thu", key: "paid", width: 18, format: "currency" },
              { label: "Còn nợ", key: "debt", width: 18, format: "currency" },
              { label: "Thanh toán", key: "paymentMethod", width: 16 },
            ],
            rows: invoiceRows.map((invoice) => ({
              code: invoice.code,
              createdAt: new Date(invoice.createdAt).toLocaleString("vi-VN"),
              branch: branchNames.get(invoice.branchId) ?? invoice.branchId,
              customer: invoice.customerName,
              subtotal: invoice.subtotal,
              discount: invoice.discountAmount,
              deliveryFee: invoice.deliveryFee,
              total: invoice.total,
              paid: invoice.paid,
              debt: invoice.debt,
              paymentMethod: invoice.paymentMethod,
            })),
            footerLabel: "Tổng cộng",
            footer: {
              subtotal: invoiceRows.reduce((sum, invoice) => sum + invoice.subtotal, 0),
              discount: invoiceRows.reduce((sum, invoice) => sum + invoice.discountAmount, 0),
              deliveryFee: invoiceRows.reduce((sum, invoice) => sum + invoice.deliveryFee, 0),
              total: invoiceRows.reduce((sum, invoice) => sum + invoice.total, 0),
              paid: invoiceRows.reduce((sum, invoice) => sum + invoice.paid, 0),
              debt: invoiceRows.reduce((sum, invoice) => sum + invoice.debt, 0),
            },
          },
        ],
      });
      toast({
        title: "Đã xuất báo cáo bán hàng",
        description:
          "Đã xuất đầy đủ " +
          invoiceRows.length.toLocaleString("vi-VN") +
          " hóa đơn.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Lỗi xuất báo cáo bán hàng",
        description: error instanceof Error ? error.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }, [
    activeBranchId,
    branchName,
    branches,
    dailyRevenue,
    kpis,
    range,
    revenueByHour,
    revenueByWeekday,
    toast,
    topInvoicesList,
  ]);

  const reportHeader = (
    <ReportPageHeader
      title="Báo cáo bán hàng"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      viewOptions={{
        chart: { label: "Tổng quan", icon: "analytics" },
        table: { label: "Danh sách", icon: "table_rows" },
      }}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || exporting}
    />
  );

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {reportHeader}
        <div className="flex-1 flex flex-col items-center justify-center">
          <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Đang tải dữ liệu phân tích...
          </p>
        </div>
      </div>
    );
  }

  const hasData =
    kpis ||
    dailyRevenue.length > 0 ||
    revenueByWeekday.length > 0 ||
    revenueByHour.length > 0 ||
    topInvoicesList.length > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">
            Chưa có dữ liệu bán hàng trong khoảng thời gian này.
          </p>
        </div>
      </div>
    );
  }

  const revenueChange = kpis
    ? calcChangePct(kpis.goodsRevenue, kpis.prevGoodsRevenue)
    : { text: "0%", positive: true };
  const qtyChange = kpis
    ? calcChangePct(kpis.soldQty, kpis.prevSoldQty)
    : { text: "0%", positive: true };
  const avgChange = kpis
    ? calcChangePct(kpis.avgOrderValue, kpis.prevAvgOrderValue)
    : { text: "0%", positive: true };
  const returnChange = kpis
    ? calcChangePct(kpis.returnRate, kpis.prevReturnRate)
    : { text: "0%", positive: true };

  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const overviewMetricMeta = SALES_OVERVIEW_METRICS[overviewMetric];
  const selectedDetailError = tableMode === "daily" ? dailyError : invoiceError;
  const selectedDetailLoading = tableMode === "daily" ? dailyLoading : invoiceLoading;
  const dailyColumns: DataTableColumn<SalesReportDailyRow>[] = [
    {
      label: "Ngày",
      key: "date",
      align: "left",
      sticky: true,
      cell: (row) => formatReportDate(row.date),
    },
    {
      label: "Đơn",
      key: "orderCount",
      align: "right",
      cell: (row) => formatNumber(row.orderCount),
    },
    {
      label: "SL bán",
      key: "soldQty",
      align: "right",
      cell: (row) => formatNumber(row.soldQty),
    },
    {
      label: "Bán gộp",
      key: "grossRevenue",
      align: "right",
      cell: (row) => formatCurrency(row.grossRevenue) + "đ",
    },
    {
      label: "Trả trong ngày",
      key: "returnAmount",
      align: "right",
      cell: (row) => formatCurrency(row.returnAmount) + "đ",
    },
    {
      label: "Doanh thu thuần",
      key: "netRevenue",
      align: "right",
      hideable: false,
      cell: (row) => formatCurrency(row.netRevenue) + "đ",
    },
    {
      label: "Đã thu",
      key: "paid",
      align: "right",
      cell: (row) => formatCurrency(row.paid) + "đ",
    },
    {
      label: "Còn nợ",
      key: "debt",
      align: "right",
      cell: (row) => formatCurrency(row.debt) + "đ",
    },
  ];

  const invoiceColumns: DataTableColumn<SalesReportInvoiceDetailRow>[] = [
    {
      label: "Mã hóa đơn",
      key: "code",
      align: "left",
      sticky: true,
      hideable: false,
      cell: (row) => <span className="font-mono text-xs text-primary">{row.code}</span>,
    },
    {
      label: "Thời gian",
      key: "createdAt",
      align: "left",
      cell: (row) => formatReportDateTime(row.createdAt),
    },
    {
      label: "Khách hàng",
      key: "customerName",
      align: "left",
    },
    {
      label: "Chi nhánh",
      key: "branchId",
      align: "left",
      cell: (row) => branchNames.get(row.branchId) ?? row.branchId,
    },
    {
      label: "Dòng / SL",
      key: "soldQty",
      align: "right",
      cell: (row) => formatNumber(row.itemCount) + " / " + formatNumber(row.soldQty),
    },
    {
      label: "Tổng đơn",
      key: "total",
      align: "right",
      cell: (row) => formatCurrency(row.total) + "đ",
    },
    {
      label: "Trả trong kỳ",
      key: "returnAmount",
      align: "right",
      cell: (row) => formatCurrency(row.returnAmount) + "đ",
    },
    {
      label: "Thuần",
      key: "netAmount",
      align: "right",
      hideable: false,
      cell: (row) => formatCurrency(row.netAmount) + "đ",
    },
    {
      label: "Đã thu",
      key: "paid",
      align: "right",
      cell: (row) => formatCurrency(row.paid) + "đ",
    },
    {
      label: "Còn nợ",
      key: "debt",
      align: "right",
      cell: (row) => formatCurrency(row.debt) + "đ",
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu hàng hóa"
            value={formatCurrency(kpis?.goodsRevenue ?? 0) + "đ"}
            change={`${revenueChange.text} so với kỳ trước`}
            positive={revenueChange.positive}
            icon="trending_up"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
            subValue={
              // Doanh thu thuần đã trừ trả hàng; phí giao thu hộ được trình bày riêng.
              <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                <span>Doanh thu thuần {formatCurrency(kpis?.netRevenue ?? 0)}đ</span>
                {(kpis?.returnAmount ?? 0) > 0 && (
                  <span>· Trả hàng {formatCurrency(kpis?.returnAmount ?? 0)}đ</span>
                )}
                {(kpis?.deliveryFee ?? 0) > 0 && (
                  <span>· Phí giao {formatCurrency(kpis?.deliveryFee ?? 0)}đ</span>
                )}
              </span>
            }
          />
          <KpiCard
            label="Số lượng bán"
            value={formatNumber(kpis?.soldQty ?? 0)}
            change={`${qtyChange.text} so với kỳ trước`}
            positive={qtyChange.positive}
            icon="inventory_2"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Giá trị trung bình mỗi đơn"
            value={formatCurrency(kpis?.avgOrderValue ?? 0) + "đ"}
            change={`${avgChange.text} so với kỳ trước`}
            positive={avgChange.positive}
            icon="receipt"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tỷ lệ trả hàng"
            value={`${(kpis?.returnRate ?? 0).toFixed(1)}%`}
            change={`${returnChange.text} so với kỳ trước`}
            positive={!returnChange.positive}
            icon="undo"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
        </div>

        {/* Drill-down data stays separate from the chart overview. */}
        {viewMode === "table" ? (
          <section className="border border-border bg-surface-container-lowest">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Chi tiết bán hàng</h2>
                <p className="text-sm text-muted-foreground">
                  {tableMode === "daily"
                    ? "Bán, trả và công nợ theo ngày phát sinh."
                    : "Mỗi hóa đơn hiển thị một dòng, có thể tải thêm khi cần."}
                </p>
              </div>
              <div
                className="inline-flex w-fit border border-border bg-muted/30 p-1"
                role="tablist"
                aria-label="Góc nhìn báo cáo bán hàng"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === "daily"}
                  onClick={() => setTableMode("daily")}
                  className={
                    tableMode === "daily"
                      ? "bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                      : "px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  }
                >
                  Theo ngày
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === "invoices"}
                  onClick={() => setTableMode("invoices")}
                  className={
                    tableMode === "invoices"
                      ? "bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                      : "px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  }
                >
                  Theo hóa đơn
                </button>
              </div>
            </div>

            {selectedDetailError ? (
              <div className="px-4 py-8 text-sm text-destructive">{selectedDetailError}</div>
            ) : selectedDetailLoading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                <Icon name="progress_activity" size={20} className="animate-spin" />
                Đang tải dữ liệu chi tiết...
              </div>
            ) : tableMode === "daily" ? (
              <ReportDataTable<SalesReportDailyRow>
                columns={dailyColumns}
                tablePreferenceKey="report.ban-hang.daily-revenue"
                rows={dailyRows}
                getRowKey={(row) => row.date}
                subtotalLabel={
                  "Doanh thu thuần: " +
                  formatCurrency(
                    dailyRows.reduce((sum, row) => sum + row.netRevenue, 0),
                  ) +
                  "đ"
                }
                emptyState="Chưa có doanh thu hoặc trả hàng trong kỳ này"
              />
            ) : (
              <div>
                <ReportDataTable<SalesReportInvoiceDetailRow>
                  columns={invoiceColumns}
                  tablePreferenceKey="report.ban-hang.invoice-drilldown"
                  rows={invoiceRows}
                  getRowKey={(row) => row.id || row.code}
                  subtotalLabel={
                    "Đã tải " +
                    formatNumber(invoiceRows.length) +
                    " hóa đơn"
                  }
                  emptyState="Chưa có hóa đơn hoàn thành trong kỳ này"
                  paginationThreshold={100}
                />
                {invoiceRowsHasMore && (
                  <div className="border-t border-border p-3 text-center">
                    <button
                      type="button"
                      onClick={() => fetchInvoiceRows(invoiceRows.length)}
                      className="border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                    >
                      Tải thêm hóa đơn
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : null}

        {viewMode === "chart" && (
          <section className="border-y border-border bg-surface-container-low px-4 py-3 lg:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Tín hiệu điều hành</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tóm tắt từ dữ liệu trong kỳ đang chọn, không phải số liệu ước tính.
                </p>
              </div>
              <div
                className="inline-flex w-fit border border-border bg-background p-1"
                role="tablist"
                aria-label="Chỉ tiêu xem trong tổng quan"
              >
                {(Object.keys(SALES_OVERVIEW_METRICS) as SalesOverviewMetric[]).map((metric) => (
                  <button
                    key={metric}
                    type="button"
                    role="tab"
                    aria-selected={overviewMetric === metric}
                    onClick={() => setOverviewMetric(metric)}
                    className={
                      overviewMetric === metric
                        ? "bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                        : "px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    }
                  >
                    {SALES_OVERVIEW_METRICS[metric].shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium text-muted-foreground">Ngày có phát sinh</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatNumber(overviewInsights.activeDays)}</p>
              </div>
              <div className="border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium text-muted-foreground">Ngày cao nhất</p>
                <p className="mt-1 text-sm font-semibold">
                  {overviewInsights.bestDay
                    ? `${formatReportDate(overviewInsights.bestDay.date)} · ${
                        overviewMetric === "netRevenue"
                          ? `${formatCurrency(overviewInsights.bestDay.value)}đ`
                          : `${formatNumber(overviewInsights.bestDay.value)} ${overviewMetric === "orderCount" ? "đơn" : "món"}`
                      }`
                    : "Chưa có"}
                </p>
              </div>
              <div className="border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium text-muted-foreground">Giờ doanh thu cao nhất</p>
                <p className="mt-1 text-sm font-semibold">
                  {overviewInsights.peakHour
                    ? `${overviewInsights.peakHour.label} · ${formatCurrency(overviewInsights.peakHour.value)}đ`
                    : "Chưa có"}
                </p>
              </div>
              <div className="border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium text-muted-foreground">Trả hàng trong kỳ</p>
                <p className="mt-1 text-sm font-semibold text-status-warning">
                  {formatCurrency(overviewInsights.returnAmount)}đ
                </p>
              </div>
            </div>
          </section>
        )}

        {/* The chart changes with the selected operational metric. The detailed
            daily RPC is the source, so overview and list never disagree. */}
        {viewMode === "chart" && overviewRows.some((row) => row.value > 0) && (
          <ChartCard
            title={`Xu hướng ${overviewMetricMeta.label.toLocaleLowerCase("vi-VN")} trong kỳ`}
            subtitle="Chọn chỉ tiêu ở phần Tín hiệu điều hành để đổi góc nhìn"
          >
            <div className="h-56 md:h-72">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 320, height: 224 }}
              >
                <LineChart
                  data={overviewRows}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={4}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      overviewMetric === "netRevenue"
                        ? formatChartCurrency(v)
                        : formatNumber(v)
                    }
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip content={<SalesOverviewTooltip metric={overviewMetric} />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={overviewMetricMeta.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, fill: overviewMetricMeta.color }}
                    name={overviewMetricMeta.label}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {/* CEO 22/05/2026 (UX P1 #4): Empty state khi kỳ không có giao dịch.
            Thay vì để chart trống với axis 1-4 vô nghĩa. */}
        {viewMode === "chart" && !dailyLoading && !overviewRows.some((row) => row.value > 0) && (
          <ChartCard title={`Xu hướng ${overviewMetricMeta.label.toLocaleLowerCase("vi-VN")} trong kỳ`} subtitle="Dữ liệu thực tế">
            <div className="h-56 md:h-72 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Icon name="show_chart" size={32} className="opacity-40" />
              <p className="text-sm font-medium">Chưa có dữ liệu cho chỉ tiêu này trong kỳ</p>
              <p className="text-xs">Đổi kỳ báo cáo hoặc chi nhánh để xem dữ liệu khác.</p>
            </div>
          </ChartCard>
        )}

        {viewMode === "chart" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue by Day of Week */}
          {revenueByWeekday.length > 0 && (
            <ChartCard
              title="Doanh thu theo thứ trong tuần"
              subtitle="Tổng doanh thu trong kỳ đã chọn"
            >
              <div className="h-56 md:h-72">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={{ width: 320, height: 224 }}
                >
                  <BarChart
                    data={revenueByWeekday}
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
                    <Tooltip content={<DayOfWeekTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[6, 6, 0, 0]}
                      name="Doanh thu"
                    >
                      {revenueByWeekday.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={DAY_COLORS[index % DAY_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {/* Revenue by Hour */}
          {revenueByHour.length > 0 && (
            <ChartCard
              title="Doanh thu theo giờ trong ngày"
              subtitle="Tổng doanh thu trong kỳ đã chọn"
            >
              <div className="h-56 md:h-72">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={{ width: 320, height: 224 }}
                >
                  <AreaChart
                    data={revenueByHour}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={2}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={45}
                    />
                    <Tooltip content={<HourlyTooltip />} />
                    <defs>
                      <linearGradient
                        id="colorRevHour"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#9333ea"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#9333ea"
                          stopOpacity={0.05}
                        />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#9333ea"
                      strokeWidth={2}
                      fill="url(#colorRevHour)"
                      name="Doanh thu"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}
        </div>
        )}

        {/* Top 10 Invoices Table — show in both modes */}
        {topInvoicesList.length > 0 && (
          <ChartCard
            title="Top 10 hóa đơn giá trị cao nhất"
            subtitle="Kỳ đã chọn"
          >
            <ReportTableFrame tablePreferenceKey="report.sales.top-invoices">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Mã HĐ</th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Khách hàng
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Giá trị
                    </th>
                    <th className="text-right py-2 font-medium">Ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {topInvoicesList.map((inv) => (
                    <tr key={inv.code} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs text-primary">
                        {inv.code}
                      </td>
                      <td className="py-3 pr-4 font-medium">
                        {inv.customer}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-primary">
                        {formatCurrency(inv.value)}đ
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {inv.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </ReportTableFrame>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
