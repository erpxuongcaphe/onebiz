"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts";
import {
  getOverviewKpis,
  getSalesReportDailyRows,
  getRevenueByCategory,
  getTopProductsByRevenue,
} from "@/lib/services";
import type {
  SalesReportDailyRow,
  CategoryRevenue,
  TopProductRevenue,
} from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";
import { formatSelectedPeriodLabel } from "@/lib/utils/date-presets";
import { buildSalesInvoiceDayLink, buildSalesReturnDayLink } from "@/lib/reports/sales-drilldown";
import { getBranchPnLComparison, type BranchPnLRow } from "@/lib/services/supabase/reports";
import { ManagementReview } from "@/components/shared/report/management-review";
import { managementFinancialRows, reportChange, sortManagementBranches } from "@/lib/reports/management-review";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";

// === Helpers ===

function calcChange(current: number, previous: number): string {
  return reportChange(current, previous);
}

// === Custom tooltip ===
interface RevenueTooltipEntry {
  color?: string;
  name?: string;
  value?: number;
}

interface RevenueTooltipProps {
  active?: boolean;
  payload?: RevenueTooltipEntry[];
  label?: string;
}

function RevenueTooltip({ active, payload, label }: RevenueTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-border rounded-lg ambient-shadow p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry, index) => (
        <p key={entry.name ?? index} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}
export default function TongQuanPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { tenant, hasPermission } = useAuth();
  const canViewProfit = hasPermission("reports.view_profit") && hasPermission("reports.view_detail");
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const selectedPeriodLabel = formatSelectedPeriodLabel(preset, range);
  const detailParams = new URLSearchParams({
    branch: activeBranchId ?? "all",
    preset,
  });
  if (preset === "custom") {
    detailParams.set("from", range.from);
    detailParams.set("to", range.to);
  }
  const salesDetailHref = "/phan-tich/ban-hang?" + detailParams.toString();
  const productDetailHref = "/phan-tich/hang-hoa?" + detailParams.toString();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Awaited<ReturnType<typeof getOverviewKpis>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [branchRows, setBranchRows] = useState<BranchPnLRow[]>([]);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchSort, setBranchSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const visibleBranches = useMemo(() => sortManagementBranches(branchRows, branchSort), [branchRows, branchSort]);
  const scopeKey = `${tenant?.id}:${activeBranchId ?? "all"}:${range.from}:${range.to}:${canViewProfit}`;
  const pending = loadedScope !== scopeKey || (!kpis && loading);
  const refreshState = useRef({ inFlight: false, queued: false });
  const refresh = useCallback(() => {
    if (refreshState.current.inFlight) {
      refreshState.current.queued = true;
      return;
    }
    setRevision(value => value + 1);
  }, []);
  useLiveDataRefresh(refresh, tenant?.id, activeBranchId, ["dashboard_live_signals"], isReady);
  const [dailyRows, setDailyRows] = useState<SalesReportDailyRow[]>([]);
  const dailyRevenue = dailyRows.map((row) => ({
    date: `${row.date.slice(8, 10)}/${row.date.slice(5, 7)}`,
    revenue: row.netRevenue,
  }));
  const [categoryRevenue, setCategoryRevenue] = useState<CategoryRevenue[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRevenue[]>([]);

  // CEO 13/05: helper resolve tên branch để in title row Excel
  const tenantName = tenant?.name;
  const financialSheets = useCallback((): ExcelSheet[] => {
    if (!canViewProfit || !kpis) return [];
    const financial = kpis.financial;
    return [{ name: "Ket qua kinh doanh", titleRows: buildReportTitleRows({ title: "KẾT QUẢ KINH DOANH", range, branchName: branchLabel, generatedAt: new Date() }), columns: [
      { label: "Chỉ tiêu", key: "metric", width: 38 },
      { label: "Kỳ hiện tại", key: "current", format: "currency", width: 20 },
      { label: "Kỳ trước", key: "previous", format: "currency", width: 20 },
      { label: "Chênh lệch", key: "difference", format: "currency", width: 20 },
    ], rows: managementFinancialRows(financial.current, financial.previous) }, ...(!activeBranchId && !branchError ? [{ name: "Dong gop chi nhanh", titleRows: buildReportTitleRows({ title: "ĐÓNG GÓP CHI NHÁNH (GỒM NỘI BỘ)", range, branchName: branchLabel, generatedAt: new Date() }), columns: [
      { label: "Chi nhánh", key: "branchName", width: 30 },
      { label: "Doanh thu hàng hóa", key: "goodsRevenue", format: "currency" as const, width: 20 },
      { label: "Giá vốn", key: "cogs", format: "currency" as const, width: 20 },
      { label: "Lãi gộp", key: "grossProfit", format: "currency" as const, width: 20 },
      { label: "Thu nhập khác", key: "otherIncome", format: "currency" as const, width: 20 },
      { label: "Chi phí vận hành", key: "opEx", format: "currency" as const, width: 20 },
      { label: "Kết quả đã ghi nhận", key: "netProfit", format: "currency" as const, width: 20 },
      { label: "Thiếu giá vốn (dòng)", key: "missingCostLines", format: "number" as const, width: 20 },
    ], rows: visibleBranches.map(row => ({ ...row, cogs: row.cogsComplete ? row.cogs : null, grossProfit: row.cogsComplete ? row.grossProfit : null, netProfit: row.cogsComplete ? row.netProfit : null })) }] : [])];
  }, [canViewProfit, kpis, activeBranchId, branchError, visibleBranches, range, branchLabel]);

  // ── Export Excel — 2 mode ──
  const handleExportView = useCallback(async () => {
    if (pending || loading || loadError || !kpis) return;
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TỔNG QUAN",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });

      // Sheet duy nhất gom KPI + top products (mirror view)
      const kpiRows = [
        { metric: "Doanh thu hàng hóa", value: kpis?.revenue ?? 0, prev: kpis?.prevRevenue ?? 0 },
        { metric: "Đơn hàng", value: kpis?.orders ?? 0, prev: kpis?.prevOrders ?? 0 },
        { metric: "Khách mới", value: kpis?.newCustomers ?? 0, prev: kpis?.prevNewCustomers ?? 0 },
        ...(canViewProfit ? [{ metric: "Kết quả sau chi phí đã ghi nhận", value: kpis.financial.current.cogsComplete ? kpis.profit : null, prev: kpis.financial.previous.cogsComplete ? kpis.prevProfit : null }] : []),
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
      await exportReportToExcel({
        kind: "tong-quan",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet, ...financialSheets()],
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
  }, [kpis, range, branchLabel, toast, pending, loading, loadError, canViewProfit, financialSheets]);

  const handleExportFull = useCallback(async () => {
    if (pending || loading || loadError || !kpis) return;
    try {
      // CEO 14/05 (research): Tổng quan = FOCUSED file, chỉ KPI snapshot +
      // tóm tắt theo chi nhánh. Top SP/KH/Chi phí/Cash flow đã có module
      // riêng (/khach-hang, /hang-hoa, /tai-chinh, /luong-tien) — KHÔNG
      // nhồi vào file Tổng quan để tránh duplicate.

      // ═════════════════════════════════════════════════════════════
      // SHEET 0: THÔNG TIN BÁO CÁO
      // ═════════════════════════════════════════════════════════════
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO TỔNG QUAN KINH DOANH",
        description:
          "KPI tổng hợp + tóm tắt theo chi nhánh. Để xem chi tiết khách hàng / hàng hoá / tài chính / cash flow, vui lòng vào module tương ứng.",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
      });

      // ═════════════════════════════════════════════════════════════
      // SHEET 1: KPI SNAPSHOT (1 trang CEO scan nhanh)
      // ═════════════════════════════════════════════════════════════
      const titleBase = {
        title: "BÁO CÁO TỔNG QUAN KINH DOANH",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
      };
      const execSummary: ExcelSheet = {
        name: "KPI Snapshot",
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
            metric: "Doanh thu thuần hàng hóa",
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
            metric: "  Doanh thu thuần / hóa đơn hoàn tất",
            current:
              (kpis?.orders ?? 0) > 0
                ? Math.round((kpis?.revenue ?? 0) / (kpis?.orders ?? 1))
                : 0,
            prev:
              (kpis?.prevOrders ?? 0) > 0
                ? Math.round((kpis?.prevRevenue ?? 0) / (kpis?.prevOrders ?? 1))
                : 0,
            diff: (kpis.orders > 0 ? Math.round(kpis.revenue / kpis.orders) : 0) - (kpis.prevOrders > 0 ? Math.round(kpis.prevRevenue / kpis.prevOrders) : 0),
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
            current: kpis.financial.current.cogsComplete ? kpis.expense : null,
            prev: kpis.financial.previous.cogsComplete ? kpis.prevExpense : null,
            diff: kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? kpis.expense - kpis.prevExpense : null,
            pct: kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? calcChange(kpis.expense, kpis.prevExpense) : "Chưa đủ giá vốn",
          },
          {
            metric: "Kết quả sau chi phí đã ghi nhận",
            current: canViewProfit && kpis.financial.current.cogsComplete ? kpis.profit : null,
            prev: canViewProfit && kpis.financial.previous.cogsComplete ? kpis.prevProfit : null,
            diff: canViewProfit && kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? kpis.profit - kpis.prevProfit : null,
            pct: canViewProfit && kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? calcChange(kpis.profit, kpis.prevProfit) : "Chưa đủ cơ sở",
          },
          {
            metric: "Biên lợi nhuận (%)",
            current: kpis.financial.current.cogsComplete ? kpis.profitMargin : null,
            prev: kpis.financial.previous.cogsComplete ? kpis.prevProfitMargin : null,
            diff: kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? kpis.profitMargin - kpis.prevProfitMargin : null,
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

      // Note: file Tổng quan KHÔNG có thêm sheet Top SP / Top KH / Chi phí
      // / Cash flow vì các trang riêng (/khach-hang, /hang-hoa, /tai-chinh,
      // /luong-tien) sẽ xuất file CHI TIẾT cho mỗi module — tránh duplicate
      // data + giữ file Tổng quan gọn (research industry KiotViet/MISA/SAP).

      const sheets: ExcelSheet[] = [infoSheet, { ...execSummary, rows: canViewProfit ? execSummary.rows : execSummary.rows.slice(0, 4) }, ...financialSheets()];

      await exportReportToExcel({
        kind: "tong-quan",
        mode: "full",
        range,
        branchName: branchLabel,
        tenantName,
        sheets,
      });
      toast({
        title: "Đã xuất Tổng quan",
        description:
          "File chứa KPI tổng hợp. Để xem chi tiết KH/SP/Tài chính/Cash flow, vui lòng dùng module tương ứng.",
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
    range,
    branchLabel,
    tenantName,
    toast,
    pending,
    loading,
    loadError,
    canViewProfit,
    financialSheets,
  ]);

  const reportHeader = (
    <ReportPageHeader
      title="Tổng quan kinh doanh"
      subtitle="Bán hàng, đóng góp chi nhánh và kết quả đã ghi nhận"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={pending || loading || Boolean(loadError) || !kpis}
    />
  );

  useEffect(() => {
    let isCurrentRequest = true;

    async function fetchData() {
      if (!isReady) return;
      refreshState.current = { inFlight: true, queued: false };
      setLoading(true);
      setLoadError(null);
      try {
        const [kpiData, daily, category, products, branchResult] = await Promise.all([
          getOverviewKpis(activeBranchId, range),
          getSalesReportDailyRows(activeBranchId, range),
          getRevenueByCategory(activeBranchId, range),
          getTopProductsByRevenue(10, activeBranchId, range),
          !activeBranchId && canViewProfit
            ? getBranchPnLComparison(range).then(rows => ({ rows, error: null })).catch((error: unknown) => ({ rows: [] as BranchPnLRow[], error: error instanceof Error ? error.message : "Không thể đối chiếu chi nhánh" }))
            : Promise.resolve({ rows: [] as BranchPnLRow[], error: null }),
        ]);
        if (!isCurrentRequest) return;
        setKpis(kpiData);
        setDailyRows(daily);
        setCategoryRevenue(category);
        setTopProducts(products);
        setBranchRows(branchResult.rows);
        setBranchError(branchResult.error);
        setLoadedScope(scopeKey);
        setUpdatedAt(new Date().toISOString());
      } catch (err) {
        if (isCurrentRequest) {
          console.error("Failed to fetch analytics data:", err);
          setLoadError(err instanceof Error ? err.message : "Không thể tải báo cáo. Vui lòng thử lại.");
          setKpis(null);
          setLoadedScope(scopeKey);
        }
      } finally {
        if (isCurrentRequest) {
          refreshState.current.inFlight = false;
          setLoading(false);
          if (refreshState.current.queued) {
            refreshState.current.queued = false;
            setRevision(value => value + 1);
          }
        }
      }
    }

    fetchData();
    return () => {
      isCurrentRequest = false;
    };
  }, [activeBranchId, range, isReady, revision, scopeKey, canViewProfit]);

  if (pending) {
    return (
      <div className="flex h-full flex-col">
        {reportHeader}
        <div
          className="flex-1 space-y-4 overflow-auto p-4 lg:p-6"
          aria-busy="true"
          aria-label="Đang tổng hợp báo cáo"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-lg bg-surface-container"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="h-80 animate-pulse rounded-lg bg-surface-container"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (loadError || !kpis) return <div className="flex h-full flex-col">{reportHeader}<div role="alert" className="m-6 space-y-3 border-l-4 border-status-error p-4"><h2 className="font-semibold">Chưa tải được báo cáo</h2><p className="text-sm text-muted-foreground">{loadError ?? "Máy chủ chưa trả dữ liệu."}</p><button type="button" onClick={refresh} className="inline-flex min-h-9 items-center gap-2 rounded border px-3 text-sm"><Icon name="refresh" size={17} />Thử lại</button></div></div>;
  return (
    <div className="flex flex-col h-full">
      {reportHeader}

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu hàng hóa"
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
          {canViewProfit ? <KpiCard
            label="Lãi gộp"
            value={kpis.financial.current.cogsComplete ? formatCurrency(kpis.financial.current.grossProfit) + "đ" : "Chưa đủ giá vốn"}
            change={kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? calcChange(kpis.financial.current.grossProfit, kpis.financial.previous.grossProfit) : undefined}
            positive={kpis.financial.current.grossProfit >= kpis.financial.previous.grossProfit}
            subValue={!kpis.financial.current.cogsComplete ? "Cần kiểm tra giá vốn lịch sử" : undefined}
            icon="price_check"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          /> : <KpiCard
            label="Khách mới"
            value={formatNumber(kpis?.newCustomers ?? 0)}
            change={calcChange(kpis?.newCustomers ?? 0, kpis?.prevNewCustomers ?? 0)}
            positive={(kpis?.newCustomers ?? 0) >= (kpis?.prevNewCustomers ?? 0)}
            icon="group"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />}
          {canViewProfit && <KpiCard
            label="Kết quả đã ghi nhận"
            value={kpis.financial.current.cogsComplete ? formatCurrency(kpis.profit) + "đ" : "Chưa đủ giá vốn"}
            change={kpis.financial.current.cogsComplete && kpis.financial.previous.cogsComplete ? calcChange(kpis.profit, kpis.prevProfit) : undefined}
            subValue="Sau các chi phí đã ghi nhận, không phải số dư tiền"
            positive={(kpis?.profit ?? 0) >= (kpis?.prevProfit ?? 0)}
            icon="trending_up"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />}
        </div>
        {canViewProfit && updatedAt && <ManagementReview current={kpis.financial.current} previous={kpis.financial.previous} branchId={activeBranchId} range={range} branches={visibleBranches} branchError={branchError} updatedAt={updatedAt} branchSort={branchSort} onBranchSort={setBranchSort} />}

        {!activeBranchId && <p className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">Các bảng bán hàng bên dưới phản ánh phát sinh hóa đơn, gồm giao dịch nội bộ; khác cơ sở với doanh thu quản trị đã loại nội bộ ở trên.</p>}

        {/* CEO 13/05: 2 mode — Biểu đồ (chart) vs Bảng số liệu kế toán (table) */}
        {viewMode === "chart" ? (
          /* Charts row */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue line chart */}
            <ChartCard
              title="Giá trị hóa đơn sau trả theo ngày"
              subtitle={selectedPeriodLabel}
              actions={
                <Link
                  href={salesDetailHref}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Xem chi tiết
                  <Icon name="arrow_forward" size={14} />
                </Link>
              }
            >
              {dailyRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo ngày
                </div>
              ) : (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
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
                      type="linear"
                      dataKey="revenue"
                      name="Giá trị hóa đơn sau trả"
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
            <ChartCard
              title="Doanh số gộp theo danh mục"
              subtitle={selectedPeriodLabel}
              actions={
                <Link
                  href={productDetailHref}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Xem chi tiết
                  <Icon name="arrow_forward" size={14} />
                </Link>
              }
            >
              {categoryRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo danh mục
                </div>
              ) : (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
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
                      name="Doanh số gộp"
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
            <ChartCard
              title="Giá trị hóa đơn sau trả theo ngày"
              subtitle={selectedPeriodLabel}
              actions={
                <Link
                  href={salesDetailHref}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Xem chi tiết
                  <Icon name="arrow_forward" size={14} />
                </Link>
              }
            >
              {dailyRows.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo ngày
                </div>
              ) : (
                <ReportTableFrame tablePreferenceKey="report.executive.daily-revenue">
                  <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-container-low">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Ngày</th>
                        <th className="py-2 px-3 font-medium text-right">Bán gộp</th>
                        <th className="py-2 px-3 font-medium text-right">Hàng trả</th>
                        <th className="py-2 px-3 font-medium text-right">Giá trị hóa đơn sau trả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map((d) => (
                        <tr
                          key={d.date}
                          className="border-b last:border-0 hover:bg-surface-container-low"
                        >
                          <td className="py-1.5 px-3 text-foreground tabular-nums">
                            {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {d.grossRevenue > 0 ? (
                              <Link href={buildSalesInvoiceDayLink(d.date, activeBranchId)} className="text-primary hover:underline">
                                {formatCurrency(d.grossRevenue)}đ
                              </Link>
                            ) : "0đ"}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {d.returnAmount > 0 ? (
                              <Link href={buildSalesReturnDayLink(d.date, activeBranchId)} className="text-primary hover:underline">
                                {formatCurrency(d.returnAmount)}đ
                              </Link>
                            ) : "0đ"}
                          </td>
                          <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                            {formatCurrency(d.netRevenue)}đ
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-foreground/20 font-bold">
                        <td className="py-2 px-3">TỔNG</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {formatCurrency(dailyRows.reduce((sum, row) => sum + row.grossRevenue, 0))}đ
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {formatCurrency(dailyRows.reduce((sum, row) => sum + row.returnAmount, 0))}đ
                        </td>
                        <td className="py-2 px-3 text-right text-primary tabular-nums">
                          {formatCurrency(dailyRows.reduce((sum, row) => sum + row.netRevenue, 0))}đ
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                </ReportTableFrame>
              )}
            </ChartCard>

            <ChartCard
              title="Doanh số gộp theo danh mục"
              subtitle={selectedPeriodLabel}
              actions={
                <Link
                  href={productDetailHref}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Xem chi tiết
                  <Icon name="arrow_forward" size={14} />
                </Link>
              }
            >
              {categoryRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo danh mục
                </div>
              ) : (
                <ReportTableFrame tablePreferenceKey="report.executive.category-revenue">
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Danh mục</th>
                        <th className="py-2 px-3 font-medium text-right">Doanh số gộp</th>
                        <th className="py-2 px-3 font-medium text-right">% tổng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = categoryRevenue.reduce(
                          (s, c) => s + c.revenue,
                          0,
                        );
                        return categoryRevenue.map((c) => (
                          <tr
                            key={c.category}
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
                </ReportTableFrame>
              )}
            </ChartCard>
          </div>
        )}

        {/* Top 10 products table */}
        <ChartCard title="Top 10 sản phẩm bán chạy" subtitle={`Theo doanh số gộp · ${selectedPeriodLabel}`}>
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Chưa có dữ liệu sản phẩm bán chạy
            </div>
          ) : (
            <ReportTableFrame tablePreferenceKey="report.executive.top-products">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium w-8">#</th>
                    <th className="pb-2 pr-4 font-medium">Sản phẩm</th>
                    <th className="pb-2 pr-4 font-medium text-right">SL bán</th>
                    <th className="pb-2 font-medium text-right">Doanh số gộp</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={p.name + i} className="border-b last:border-0 hover:bg-surface-container-low">
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="py-2 pr-4 font-medium text-foreground">{p.name}</td>
                      <td className="py-2 pr-4 text-right text-foreground">{formatNumber(p.qty)}</td>
                      <td className="py-2 text-right font-semibold text-primary">
                        {formatCurrency(p.revenue)}đ
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </ReportTableFrame>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
