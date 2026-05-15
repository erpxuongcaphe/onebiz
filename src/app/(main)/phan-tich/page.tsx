"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  formatCurrency,
  formatNumber,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import { KpiCard, ChartCard } from "./_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts";
import {
  getOverviewKpis,
  getDailyRevenue,
  getRevenueByCategory,
  getTopProductsByRevenue,
  getTopCustomersByRevenue,
  getFinanceKpis,
  getExpenseBreakdown,
  getCashFlowDetailed,
} from "@/lib/services";
import type {
  MonthlyRevenuePoint,
  CategoryRevenue,
  TopProductRevenue,
  TopCustomer,
  CashFlowDetailedRow,
} from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";

// === Helpers ===

function calcChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% so với tháng trước`;
}

// === Custom tooltip ===
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-border rounded-lg ambient-shadow p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function TongQuanPage() {
  const { activeBranchId } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<{
    revenue: number; prevRevenue: number;
    orders: number; prevOrders: number;
    newCustomers: number; prevNewCustomers: number;
    profit: number; prevProfit: number;
  } | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [categoryRevenue, setCategoryRevenue] = useState<CategoryRevenue[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRevenue[]>([]);
  // CEO 14/05: thêm data cho báo cáo Excel chi tiết hơn (financial + customers + cash flow)
  const [financeKpis, setFinanceKpis] = useState<{
    revenue: number; prevRevenue: number;
    expense: number; prevExpense: number;
    profit: number; prevProfit: number;
    profitMargin: number; prevProfitMargin: number;
  } | null>(null);
  const [expenseBreakdown, setExpenseBreakdown] = useState<
    { name: string; value: number }[]
  >([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowDetailedRow[]>([]);

  // CEO 13/05: helper resolve tên branch để in title row Excel
  const tenantName = useAuth().tenant?.name;
  const branchLabel =
    activeBranchId
      ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
      : "Tất cả chi nhánh";

  // Fetch supplementary data cho Excel
  useEffect(() => {
    Promise.all([
      getFinanceKpis(activeBranchId ?? undefined, range),
      getExpenseBreakdown(activeBranchId ?? undefined, range),
      getTopCustomersByRevenue(20, activeBranchId ?? undefined),
      getCashFlowDetailed(6, activeBranchId ?? undefined),
    ])
      .then(([fin, exp, cust, cash]) => {
        setFinanceKpis(fin);
        setExpenseBreakdown(exp);
        setTopCustomers(cust);
        setCashFlow(cash);
      })
      .catch(() => {
        // Silent — fallback empty
      });
  }, [activeBranchId, range]);

  // ── Export Excel — 2 mode ──
  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TỔNG QUAN",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });

      // Sheet duy nhất gom KPI + top products (mirror view)
      const kpiRows = [
        { metric: "Doanh thu", value: kpis?.revenue ?? 0, prev: kpis?.prevRevenue ?? 0 },
        { metric: "Đơn hàng", value: kpis?.orders ?? 0, prev: kpis?.prevOrders ?? 0 },
        { metric: "Khách mới", value: kpis?.newCustomers ?? 0, prev: kpis?.prevNewCustomers ?? 0 },
        { metric: "Lợi nhuận", value: kpis?.profit ?? 0, prev: kpis?.prevProfit ?? 0 },
      ];

      const sheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: title,
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 24 },
          { label: "Kỳ hiện tại", key: "value", width: 18, format: "currency" },
          { label: "Kỳ trước", key: "prev", width: 18, format: "currency" },
        ],
        rows: kpiRows,
      };
      exportReportToExcel({
        kind: "tai-chinh",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({
        title: "Đã xuất Excel (view)",
        description: "File đã được tải về máy.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [kpis, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      const titleBase = {
        title: "BÁO CÁO TỔNG QUAN KINH DOANH",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
      };

      // Helpers
      const totalRevenueByCat = categoryRevenue.reduce((s, c) => s + c.revenue, 0);
      const totalRevenueByDay = dailyRevenue.reduce((s, d) => s + d.revenue, 0);
      const totalQty = topProducts.reduce((s, p) => s + p.qty, 0);
      const totalRevenueTop = topProducts.reduce((s, p) => s + p.revenue, 0);
      const totalExpense = expenseBreakdown.reduce((s, e) => s + e.value, 0);
      const totalCustomerRev = topCustomers.reduce((s, c) => s + c.revenue, 0);
      const totalCustomerOrders = topCustomers.reduce((s, c) => s + c.orders, 0);

      // ═════════════════════════════════════════════════════════════
      // SHEET 1: EXECUTIVE SUMMARY (1 trang CEO scan nhanh)
      // ═════════════════════════════════════════════════════════════
      const execSummary: ExcelSheet = {
        name: "1. Tổng hợp",
        titleRows: buildReportTitleRows(titleBase),
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 32 },
          { label: "Kỳ hiện tại", key: "current", width: 20, format: "currency" },
          { label: "Kỳ trước", key: "prev", width: 20, format: "currency" },
          { label: "Chênh lệch", key: "diff", width: 18, format: "currency" },
          { label: "% thay đổi", key: "pct", width: 14, align: "right" },
        ],
        rows: [
          // ─ Doanh thu ─
          {
            metric: "Tổng doanh thu",
            current: kpis?.revenue ?? 0,
            prev: kpis?.prevRevenue ?? 0,
            diff: (kpis?.revenue ?? 0) - (kpis?.prevRevenue ?? 0),
            pct: calcChange(kpis?.revenue ?? 0, kpis?.prevRevenue ?? 0),
          },
          {
            metric: "  Số đơn hàng",
            current: kpis?.orders ?? 0,
            prev: kpis?.prevOrders ?? 0,
            diff: (kpis?.orders ?? 0) - (kpis?.prevOrders ?? 0),
            pct: calcChange(kpis?.orders ?? 0, kpis?.prevOrders ?? 0),
          },
          {
            metric: "  TB / đơn hàng",
            current:
              (kpis?.orders ?? 0) > 0
                ? Math.round((kpis?.revenue ?? 0) / (kpis?.orders ?? 1))
                : 0,
            prev:
              (kpis?.prevOrders ?? 0) > 0
                ? Math.round((kpis?.prevRevenue ?? 0) / (kpis?.prevOrders ?? 1))
                : 0,
            diff: 0,
            pct: "",
          },
          // ─ Khách hàng ─
          {
            metric: "Khách hàng mới",
            current: kpis?.newCustomers ?? 0,
            prev: kpis?.prevNewCustomers ?? 0,
            diff: (kpis?.newCustomers ?? 0) - (kpis?.prevNewCustomers ?? 0),
            pct: calcChange(kpis?.newCustomers ?? 0, kpis?.prevNewCustomers ?? 0),
          },
          // ─ Chi phí + Lợi nhuận ─
          {
            metric: "Tổng chi phí",
            current: financeKpis?.expense ?? 0,
            prev: financeKpis?.prevExpense ?? 0,
            diff: (financeKpis?.expense ?? 0) - (financeKpis?.prevExpense ?? 0),
            pct: calcChange(financeKpis?.expense ?? 0, financeKpis?.prevExpense ?? 0),
          },
          {
            metric: "Lợi nhuận gộp",
            current: kpis?.profit ?? 0,
            prev: kpis?.prevProfit ?? 0,
            diff: (kpis?.profit ?? 0) - (kpis?.prevProfit ?? 0),
            pct: calcChange(kpis?.profit ?? 0, kpis?.prevProfit ?? 0),
          },
          {
            metric: "Biên lợi nhuận (%)",
            current: financeKpis?.profitMargin ?? 0,
            prev: financeKpis?.prevProfitMargin ?? 0,
            diff:
              (financeKpis?.profitMargin ?? 0) - (financeKpis?.prevProfitMargin ?? 0),
            pct: "",
          },
        ],
        sections: {
          0: "I. CHỈ SỐ DOANH THU",
          3: "II. CHỈ SỐ KHÁCH HÀNG",
          4: "III. CHỈ SỐ TÀI CHÍNH",
        },
        withSignature: true,
      };

      // ═════════════════════════════════════════════════════════════
      // SHEET 2: P&L — BÁO CÁO LÃI LỖ
      // ═════════════════════════════════════════════════════════════
      const profitLoss: ExcelSheet = {
        name: "2. Lãi-Lỗ (P&L)",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "BÁO CÁO KẾT QUẢ KINH DOANH",
        }),
        columns: [
          { label: "STT", key: "stt", width: 6, align: "center" },
          { label: "Chỉ tiêu", key: "metric", width: 40 },
          { label: "Kỳ này (VND)", key: "current", width: 20, format: "currency" },
          { label: "Kỳ trước (VND)", key: "prev", width: 20, format: "currency" },
          { label: "Chênh lệch (VND)", key: "diff", width: 20, format: "currency" },
        ],
        rows: [
          {
            stt: 1,
            metric: "Doanh thu bán hàng",
            current: kpis?.revenue ?? 0,
            prev: kpis?.prevRevenue ?? 0,
            diff: (kpis?.revenue ?? 0) - (kpis?.prevRevenue ?? 0),
          },
          {
            stt: 2,
            metric: "Tổng chi phí",
            current: financeKpis?.expense ?? 0,
            prev: financeKpis?.prevExpense ?? 0,
            diff: (financeKpis?.expense ?? 0) - (financeKpis?.prevExpense ?? 0),
          },
          {
            stt: 3,
            metric: "Lợi nhuận trước thuế",
            current: kpis?.profit ?? 0,
            prev: kpis?.prevProfit ?? 0,
            diff: (kpis?.profit ?? 0) - (kpis?.prevProfit ?? 0),
          },
        ],
      };

      // ═════════════════════════════════════════════════════════════
      // SHEET 3: DOANH THU CHI TIẾT (theo ngày + theo danh mục)
      // ═════════════════════════════════════════════════════════════
      const revenueDetail: ExcelSheet = {
        name: "3. Doanh thu chi tiết",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "DOANH THU CHI TIẾT THEO NGÀY",
        }),
        columns: [
          { label: "STT", key: "stt", width: 6, align: "center" },
          { label: "Ngày", key: "date", width: 16 },
          { label: "Doanh thu (VND)", key: "revenue", width: 22, format: "currency" },
          {
            label: "Tỷ trọng (%)",
            key: "share",
            width: 14,
            format: "percent",
          },
        ],
        rows: dailyRevenue.map((d, i) => ({
          stt: i + 1,
          date: d.date,
          revenue: d.revenue,
          share: totalRevenueByDay > 0 ? (d.revenue / totalRevenueByDay) * 100 : 0,
        })),
        footer: {
          stt: "",
          date: "TỔNG CỘNG",
          revenue: totalRevenueByDay,
          share: 100,
        },
      };

      // ═════════════════════════════════════════════════════════════
      // SHEET 4: THEO DANH MỤC
      // ═════════════════════════════════════════════════════════════
      const categorySheet: ExcelSheet = {
        name: "4. Theo danh mục",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "DOANH THU THEO DANH MỤC SẢN PHẨM",
        }),
        columns: [
          { label: "STT", key: "stt", width: 6, align: "center" },
          { label: "Danh mục", key: "category", width: 28 },
          { label: "Doanh thu (VND)", key: "revenue", width: 22, format: "currency" },
          { label: "Tỷ trọng (%)", key: "share", width: 14, format: "percent" },
        ],
        rows: categoryRevenue.map((c, i) => ({
          stt: i + 1,
          category: c.category,
          revenue: c.revenue,
          share: totalRevenueByCat > 0 ? (c.revenue / totalRevenueByCat) * 100 : 0,
        })),
        footer: {
          stt: "",
          category: "TỔNG CỘNG",
          revenue: totalRevenueByCat,
          share: 100,
        },
      };

      // ═════════════════════════════════════════════════════════════
      // SHEET 5: TOP SẢN PHẨM
      // ═════════════════════════════════════════════════════════════
      const topProductsSheet: ExcelSheet = {
        name: "5. Top SP bán chạy",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "TOP 10 SẢN PHẨM BÁN CHẠY",
        }),
        columns: [
          { label: "STT", key: "stt", width: 6, align: "center" },
          { label: "Tên sản phẩm", key: "name", width: 40 },
          { label: "Số lượng", key: "qty", width: 12, format: "number" },
          { label: "Doanh thu (VND)", key: "revenue", width: 22, format: "currency" },
          { label: "Tỷ trọng (%)", key: "share", width: 14, format: "percent" },
        ],
        rows: topProducts.map((p, i) => ({
          stt: i + 1,
          name: p.name,
          qty: p.qty,
          revenue: p.revenue,
          share: totalRevenueTop > 0 ? (p.revenue / totalRevenueTop) * 100 : 0,
        })),
        footer: {
          stt: "",
          name: "TỔNG CỘNG",
          qty: totalQty,
          revenue: totalRevenueTop,
          share: 100,
        },
      };

      // ═════════════════════════════════════════════════════════════
      // SHEET 6: TOP KHÁCH HÀNG
      // ═════════════════════════════════════════════════════════════
      const topCustomersSheet: ExcelSheet = {
        name: "6. Top khách hàng",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "TOP 20 KHÁCH HÀNG THEO DOANH THU",
        }),
        columns: [
          { label: "Hạng", key: "rank", width: 6, align: "center" },
          { label: "Tên khách hàng", key: "name", width: 36 },
          { label: "Số đơn", key: "orders", width: 12, format: "number" },
          { label: "Doanh thu (VND)", key: "revenue", width: 22, format: "currency" },
          {
            label: "TB / đơn (VND)",
            key: "avgTicket",
            width: 18,
            format: "currency",
          },
          {
            label: "% tổng",
            key: "share",
            width: 12,
            format: "percent",
          },
        ],
        rows: topCustomers.map((c) => ({
          rank: c.rank,
          name: c.name,
          orders: c.orders,
          revenue: c.revenue,
          avgTicket: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
          share: totalCustomerRev > 0 ? (c.revenue / totalCustomerRev) * 100 : 0,
        })),
        footer: {
          rank: "",
          name: "TỔNG CỘNG (top 20)",
          orders: totalCustomerOrders,
          revenue: totalCustomerRev,
          avgTicket: "",
          share: 100,
        },
      };

      // ═════════════════════════════════════════════════════════════
      // SHEET 7: CƠ CẤU CHI PHÍ
      // ═════════════════════════════════════════════════════════════
      const expenseSheet: ExcelSheet = {
        name: "7. Cơ cấu chi phí",
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
        rows: expenseBreakdown.map((e, i) => ({
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

      // ═════════════════════════════════════════════════════════════
      // SHEET 8: LƯU CHUYỂN TIỀN TỆ
      // ═════════════════════════════════════════════════════════════
      const cashFlowSheet: ExcelSheet = {
        name: "8. Lưu chuyển tiền",
        titleRows: buildReportTitleRows({
          ...titleBase,
          title: "LƯU CHUYỂN TIỀN TỆ 6 THÁNG GẦN NHẤT",
        }),
        columns: [
          { label: "Tháng", key: "month", width: 16 },
          { label: "Thu (VND)", key: "receipt", width: 20, format: "currency" },
          { label: "Chi (VND)", key: "payment", width: 20, format: "currency" },
          { label: "Dòng tiền ròng", key: "net", width: 20, format: "currency" },
          {
            label: "Số dư luỹ kế",
            key: "balance",
            width: 20,
            format: "currency",
          },
        ],
        rows: cashFlow.map((c) => ({
          month: c.month,
          receipt: c.totalReceipt,
          payment: c.totalPayment,
          net: c.net,
          balance: c.cumulativeBalance,
        })),
        footer: {
          month: "TỔNG CỘNG",
          receipt: cashFlow.reduce((s, c) => s + c.totalReceipt, 0),
          payment: cashFlow.reduce((s, c) => s + c.totalPayment, 0),
          net: cashFlow.reduce((s, c) => s + c.net, 0),
          balance: "",
        },
      };

      const sheets: ExcelSheet[] = [
        execSummary,
        profitLoss,
        revenueDetail,
        categorySheet,
        topProductsSheet,
        topCustomersSheet,
        expenseSheet,
        cashFlowSheet,
      ];

      exportReportToExcel({
        kind: "tai-chinh",
        mode: "full",
        range,
        branchName: branchLabel,
        tenantName,
        sheets,
      });
      toast({
        title: "Đã xuất báo cáo Excel",
        description: `${sheets.length} sheet: Tổng hợp + P&L + Doanh thu + Danh mục + Top SP + Top KH + Chi phí + Cash flow`,
        variant: "success",
        duration: 6000,
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [
    kpis,
    financeKpis,
    dailyRevenue,
    categoryRevenue,
    topProducts,
    topCustomers,
    expenseBreakdown,
    cashFlow,
    range,
    branchLabel,
    tenantName,
    toast,
  ]);

  const reportHeader = (
    <ReportPageHeader
      title="Tổng quan"
      subtitle="Phân tích kinh doanh tổng hợp"
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

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [kpiData, daily, category, products] = await Promise.all([
          getOverviewKpis(activeBranchId, range),
          getDailyRevenue(30, activeBranchId, range),
          getRevenueByCategory(activeBranchId, range),
          getTopProductsByRevenue(10, activeBranchId, range),
        ]);
        setKpis(kpiData);
        setDailyRevenue(daily);
        setCategoryRevenue(category);
        setTopProducts(products);
      } catch (err) {
        console.error("Failed to fetch analytics data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeBranchId, range]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {reportHeader}

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={formatCurrency(kpis?.revenue ?? 0) + "đ"}
            change={calcChange(kpis?.revenue ?? 0, kpis?.prevRevenue ?? 0)}
            positive={(kpis?.revenue ?? 0) >= (kpis?.prevRevenue ?? 0)}
            icon="attach_money"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Đơn hàng"
            value={formatNumber(kpis?.orders ?? 0)}
            change={calcChange(kpis?.orders ?? 0, kpis?.prevOrders ?? 0)}
            positive={(kpis?.orders ?? 0) >= (kpis?.prevOrders ?? 0)}
            icon="shopping_cart"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Khách mới"
            value={formatNumber(kpis?.newCustomers ?? 0)}
            change={calcChange(kpis?.newCustomers ?? 0, kpis?.prevNewCustomers ?? 0)}
            positive={(kpis?.newCustomers ?? 0) >= (kpis?.prevNewCustomers ?? 0)}
            icon="group"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Lợi nhuận"
            value={formatCurrency(kpis?.profit ?? 0) + "đ"}
            change={calcChange(kpis?.profit ?? 0, kpis?.prevProfit ?? 0)}
            positive={(kpis?.profit ?? 0) >= (kpis?.prevProfit ?? 0)}
            icon="trending_up"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
        </div>

        {/* CEO 13/05: 2 mode — Biểu đồ (chart) vs Bảng số liệu kế toán (table) */}
        {viewMode === "chart" ? (
          /* Charts row */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue line chart */}
            <ChartCard title="Doanh thu theo ngày" subtitle="30 ngày gần nhất">
              {dailyRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo ngày
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={dailyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval={4}
                    />
                    <YAxis
                      tickFormatter={formatChartCurrency}
                      tick={{ fontSize: 11 }}
                      width={48}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name="Doanh thu"
                      stroke="#004AC6"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Revenue by category bar chart */}
            <ChartCard title="Doanh thu theo danh mục" subtitle="Tháng hiện tại">
              {categoryRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo danh mục
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryRevenue} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      type="number"
                      tickFormatter={formatChartCurrency}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      width={120}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Bar
                      dataKey="revenue"
                      name="Doanh thu"
                      fill="#004AC6"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        ) : (
          /* Table view — 2 bảng số liệu kế toán: theo ngày + theo danh mục */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Doanh thu theo ngày" subtitle="30 ngày gần nhất">
              {dailyRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo ngày
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-container-low">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Ngày</th>
                        <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRevenue.map((d, i) => (
                        <tr
                          key={i}
                          className="border-b last:border-0 hover:bg-surface-container-low"
                        >
                          <td className="py-1.5 px-3 text-foreground tabular-nums">
                            {d.date}
                          </td>
                          <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                            {formatCurrency(d.revenue)}đ
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-foreground/20 font-bold">
                        <td className="py-2 px-3">TỔNG</td>
                        <td className="py-2 px-3 text-right text-primary tabular-nums">
                          {formatCurrency(
                            dailyRevenue.reduce((s, d) => s + d.revenue, 0),
                          )}đ
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Doanh thu theo danh mục" subtitle="Tháng hiện tại">
              {categoryRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo danh mục
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Danh mục</th>
                        <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                        <th className="py-2 px-3 font-medium text-right">% tổng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = categoryRevenue.reduce(
                          (s, c) => s + c.revenue,
                          0,
                        );
                        return categoryRevenue.map((c, i) => (
                          <tr
                            key={i}
                            className="border-b last:border-0 hover:bg-surface-container-low"
                          >
                            <td className="py-1.5 px-3 font-medium text-foreground">
                              {c.category}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums">
                              {formatCurrency(c.revenue)}đ
                            </td>
                            <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums">
                              {total > 0
                                ? ((c.revenue / total) * 100).toFixed(1) + "%"
                                : "—"}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-foreground/20 font-bold">
                        <td className="py-2 px-3">TỔNG</td>
                        <td className="py-2 px-3 text-right text-primary tabular-nums">
                          {formatCurrency(
                            categoryRevenue.reduce((s, c) => s + c.revenue, 0),
                          )}đ
                        </td>
                        <td className="py-2 px-3 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>
        )}

        {/* Top 10 products table */}
        <ChartCard title="Top 10 sản phẩm bán chạy" subtitle="Theo doanh thu tháng này">
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Chưa có dữ liệu sản phẩm bán chạy
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium w-8">#</th>
                    <th className="pb-2 pr-4 font-medium">Sản phẩm</th>
                    <th className="pb-2 pr-4 font-medium text-right">SL bán</th>
                    <th className="pb-2 font-medium text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-surface-container-low">
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="py-2 pr-4 font-medium text-foreground">{p.name}</td>
                      <td className="py-2 pr-4 text-right text-foreground">{p.qty}</td>
                      <td className="py-2 text-right font-semibold text-primary">
                        {formatCurrency(p.revenue)}đ
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
