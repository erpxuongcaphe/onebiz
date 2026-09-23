"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { formatCurrency, formatChartCurrency, formatChartTooltipCurrency, formatNumber } from "@/lib/format";
import {
  getFnbKpis,
  getFnbInvoiceDetailPage,
  getFnbInvoiceExportRows,
  getFnbReturnDetailPage,
  getFnbReturnExportRows,
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
  FnbInvoiceDetailRow,
  FnbReturnDetailRow,
} from "@/lib/services/supabase/fnb-analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";
import { LoadErrorState } from "@/components/shared/load-error-state";
import { formatSelectedPeriodLabel } from "@/lib/utils/date-presets";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";

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
            : `${formatNumber(p.value)} đơn`}
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
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { hasPermission } = useAuth();
  const canViewInvoiceDetail = hasPermission(PERMISSIONS.REPORTS_VIEW_DETAIL);
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [kpis, setKpis] = useState<FnbKpis | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemRevenue[]>([]);
  const [tables, setTables] = useState<TableRevenue[]>([]);
  const [hourly, setHourly] = useState<HourlyRevenue[]>([]);
  const [cashiers, setCashiers] = useState<CashierPerformance[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<FnbInvoiceDetailRow[]>([]);
  const [invoiceHasMore, setInvoiceHasMore] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [returnRows, setReturnRows] = useState<FnbReturnDetailRow[]>([]);
  const [returnHasMore, setReturnHasMore] = useState(false);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const invoiceRequestIdRef = useRef(0);
  const returnRequestIdRef = useRef(0);
  const selectedPeriodLabel = formatSelectedPeriodLabel(preset, range);

  useEffect(() => {
    if (!isReady) return;
    const requestId = ++requestIdRef.current;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // P1-3B-R1 12/06/2026: truyền range vào 4 panel (top món, top bàn,
        // theo giờ, cashier) — trước đây all-time mạo danh "kỳ này".
        const [k, m, t, h, c] = await Promise.all([
          getFnbKpis(activeBranchId, range),
          getRevenueByMenuItem(activeBranchId, 15, range),
          getRevenueByTable(activeBranchId, range),
          getRevenueByHourFnb(activeBranchId, range),
          getCashierPerformance(activeBranchId, range),
        ]);
        if (requestId !== requestIdRef.current) return;
        setKpis(k);
        setMenuItems(m);
        setTables(t);
        setHourly(h);
        setCashiers(c);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setLoadError(err instanceof Error ? err.message : "Không tải được báo cáo F&B.");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    })();
  }, [activeBranchId, range, isReady, reloadToken]);

  const loadInvoicePage = useCallback(async (offset: number) => {
    const requestId = ++invoiceRequestIdRef.current;
    setInvoiceLoading(true);
    setInvoiceError(null);
    if (offset === 0) {
      setInvoiceRows([]);
      setInvoiceHasMore(false);
    }
    try {
      const page = await getFnbInvoiceDetailPage(activeBranchId, range, offset, 50);
      if (requestId !== invoiceRequestIdRef.current) return;
      setInvoiceRows((current) => offset === 0 ? page.rows : [...current, ...page.rows]);
      setInvoiceHasMore(page.hasMore);
    } catch (error) {
      if (requestId !== invoiceRequestIdRef.current) return;
      setInvoiceError(error instanceof Error ? error.message : "Không tải được hóa đơn F&B.");
    } finally {
      if (requestId === invoiceRequestIdRef.current) setInvoiceLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady || !canViewInvoiceDetail || viewMode !== "table") return;
    void loadInvoicePage(0);
    return () => { invoiceRequestIdRef.current += 1; };
  }, [isReady, canViewInvoiceDetail, viewMode, loadInvoicePage]);

  const loadReturnPage = useCallback(async (offset: number) => {
    const requestId = ++returnRequestIdRef.current;
    setReturnLoading(true);
    setReturnError(null);
    if (offset === 0) {
      setReturnRows([]);
      setReturnHasMore(false);
    }
    try {
      const page = await getFnbReturnDetailPage(activeBranchId, range, offset, 50);
      if (requestId !== returnRequestIdRef.current) return;
      setReturnRows((current) => offset === 0 ? page.rows : [...current, ...page.rows]);
      setReturnHasMore(page.hasMore);
    } catch (error) {
      if (requestId !== returnRequestIdRef.current) return;
      setReturnError(error instanceof Error ? error.message : "Không tải được phiếu trả F&B.");
    } finally {
      if (requestId === returnRequestIdRef.current) setReturnLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady || !canViewInvoiceDetail) return;
    void loadReturnPage(0);
    return () => { returnRequestIdRef.current += 1; };
  }, [isReady, canViewInvoiceDetail, loadReturnPage]);

  // CEO 13/05: Export Excel — 2 mode (view: 1 sheet, full: 4 sheet)
  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO F&B",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const kpiRows = [
        { metric: "Doanh thu hóa đơn (đ)", value: kpis?.totalRevenue ?? 0 },
        { metric: "Trả hàng trong kỳ (đ)", value: kpis?.returnAmount ?? 0 },
        { metric: "Doanh thu sau trả hàng (đ)", value: kpis?.netRevenue ?? 0 },
        { metric: "Số hóa đơn", value: kpis?.totalOrders ?? 0 },
        { metric: "TB / hóa đơn (đ)", value: kpis?.avgTicket ?? 0 },
        { metric: "Turnover TB (phút)", value: kpis?.avgTurnoverMinutes ?? 0 },
      ];
      const sheet: ExcelSheet = {
        name: "KPI F&B",
        titleRows: title,
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 24 },
          { label: "Giá trị", key: "value", width: 18 },
        ],
        rows: kpiRows,
      };
      exportReportToExcel({
        kind: "fnb",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [kpis, range, branchLabel, toast]);

  const handleExportFull = useCallback(async () => {
    setExporting(true);
    try {
      const invoiceExportRows = canViewInvoiceDetail
        ? await getFnbInvoiceExportRows(activeBranchId, range)
        : [];
      const returnExportRows = canViewInvoiceDetail
        ? await getFnbReturnExportRows(activeBranchId, range)
        : [];
      const title = buildReportTitleRows({
        title: "BÁO CÁO F&B — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        ...(canViewInvoiceDetail ? [{
          name: "Hoa don F&B",
          titleRows: ["CHI TIẾT HÓA ĐƠN F&B", ...title.slice(1)],
          columns: [
            { label: "Mã hóa đơn", key: "code", width: 18 },
            { label: "Ngày chứng từ", key: "issuedAt", width: 22 },
            { label: "Khách hàng", key: "customerName", width: 28 },
            { label: "Trạng thái", key: "status", width: 16 },
            { label: "Phương thức", key: "paymentMethod", width: 18 },
            { label: "Tổng tiền", key: "total", width: 18, format: "currency" },
            { label: "Đã thu", key: "paid", width: 18, format: "currency" },
            { label: "Còn nợ", key: "debt", width: 18, format: "currency" },
          ],
          rows: invoiceExportRows.map((invoice) => ({
            code: invoice.code,
            issuedAt: new Date(invoice.issuedAt).toLocaleString("vi-VN"),
            customerName: invoice.customerName,
            status: invoice.status,
            paymentMethod: invoice.paymentMethod,
            total: invoice.total,
            paid: invoice.paid,
            debt: invoice.debt,
          })),
        } satisfies ExcelSheet] : []),
        ...(canViewInvoiceDetail ? [{
          name: "Phieu tra F&B",
          titleRows: ["CHI TIẾT PHIẾU TRẢ F&B", ...title.slice(1)],
          columns: [
            { label: "Mã phiếu trả", key: "code", width: 20 },
            { label: "Ngày lập", key: "createdAt", width: 22 },
            { label: "Hóa đơn gốc", key: "invoiceCode", width: 20 },
            { label: "Giá trị trả", key: "total", width: 18, format: "currency" },
            { label: "Đã hoàn tiền", key: "refunded", width: 18, format: "currency" },
          ],
          rows: returnExportRows.map((row) => ({
            code: row.code,
            createdAt: new Date(row.createdAt).toLocaleString("vi-VN"),
            invoiceCode: row.invoiceCode,
            total: row.total,
            refunded: row.refunded,
          })),
        } satisfies ExcelSheet] : []),
        {
          name: "KPI F&B",
          titleRows: title,
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 24 },
            { label: "Giá trị", key: "value", width: 18 },
          ],
          rows: [
            { metric: "Doanh thu hóa đơn (đ)", value: kpis?.totalRevenue ?? 0 },
            { metric: "Trả hàng trong kỳ (đ)", value: kpis?.returnAmount ?? 0 },
            { metric: "Doanh thu sau trả hàng (đ)", value: kpis?.netRevenue ?? 0 },
            { metric: "Số hóa đơn", value: kpis?.totalOrders ?? 0 },
            { metric: "TB / hóa đơn (đ)", value: kpis?.avgTicket ?? 0 },
            { metric: "Turnover TB (phút)", value: kpis?.avgTurnoverMinutes ?? 0 },
          ],
        },
        {
          name: "Top món bếp",
          titleRows: ["TOP 15 MÓN BẾP HOÀN THÀNH - TRƯỚC GIẢM GIÁ", ...title.slice(1)],
          columns: [
            { label: "STT", key: "rank", width: 6 },
            { label: "Tên món", key: "name", width: 32 },
            { label: "SL bán", key: "qty", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: menuItems.map((m, i) => ({
            rank: i + 1,
            name: m.productName,
            qty: m.quantity,
            revenue: m.revenue,
          })),
          footer: {
            rank: "",
            name: "CỘNG TOP 15",
            qty: menuItems.reduce((s, m) => s + m.quantity, 0),
            revenue: menuItems.reduce((s, m) => s + m.revenue, 0),
          },
        },
        {
          name: "Theo bàn",
          titleRows: ["DOANH THU THEO BÀN", ...title.slice(1)],
          columns: [
            { label: "Bàn", key: "name", width: 16 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: tables.map((t) => ({
            name: t.tableName,
            orders: t.orders,
            revenue: t.revenue,
          })),
          footer: {
            name: "TỔNG",
            orders: tables.reduce((s, t) => s + t.orders, 0),
            revenue: tables.reduce((s, t) => s + t.revenue, 0),
          },
        },
        {
          name: "Theo giờ",
          titleRows: ["DOANH THU THEO GIỜ", ...title.slice(1)],
          columns: [
            { label: "Khung giờ", key: "label", width: 14 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: hourly.map((h) => ({
            label: h.label,
            orders: h.orders,
            revenue: h.revenue,
          })),
        },
        {
          name: "Theo nhân viên",
          titleRows: ["HIỆU SUẤT NHÂN VIÊN", ...title.slice(1)],
          columns: [
            { label: "Nhân viên", key: "name", width: 24 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
            { label: "TB / đơn (VND)", key: "avgTicket", width: 18, format: "currency" },
          ],
          rows: cashiers.map((c) => ({
            name: c.cashierName,
            orders: c.orders,
            revenue: c.revenue,
            avgTicket: c.avgTicket,
          })),
        },
      ];
      exportReportToExcel({
        kind: "fnb",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({
        title: "Đã xuất Excel (đầy đủ)",
        description: "Gồm hóa đơn, phiếu trả F&B, chỉ tiêu và các bảng phân tích.",
        variant: "success",
        duration: 5000,
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }, [activeBranchId, canViewInvoiceDetail, kpis, menuItems, tables, hourly, cashiers, range, branchLabel, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <ReportPageHeader
          title="Doanh thu và vận hành F&B"
          subtitle="Hóa đơn, doanh thu theo giờ, món bếp, bàn và nhân viên"
          preset={preset}
          range={range}
          onPresetChange={setPreset}
          onCustomRangeChange={setCustomRange}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          exportDisabled
        />
        <div className="p-4">
          <LoadErrorState
            title="Không tải được báo cáo F&B"
            description={`${loadError} Không hiển thị số 0 thay cho dữ liệu chưa tải được.`}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <ReportPageHeader
        title="Doanh thu và vận hành F&B"
        subtitle="Hóa đơn, doanh thu theo giờ, món bếp, bàn và nhân viên"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || exporting || !kpis}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        <KpiCard
          label="Doanh thu hóa đơn F&B"
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
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Trung bình/đơn"
          value={formatCurrency(kpis?.avgTicket ?? 0)}
          icon="receipt"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Turnover trung bình"
          value={`${kpis?.avgTurnoverMinutes ?? 0} phút`}
          icon="schedule"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-foreground"
        />
      </div>

      <div className="mx-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-3 text-sm">
        <span>Trả hàng trong kỳ: <strong className="tabular-nums">{formatCurrency(kpis?.returnAmount ?? 0)}đ</strong></span>
        <span>Doanh thu sau trả hàng: <strong className="tabular-nums text-primary">{formatCurrency(kpis?.netRevenue ?? 0)}đ</strong></span>
        {canViewInvoiceDetail && <a href="#fnb-return-title" className="font-medium text-primary underline-offset-2 hover:underline">Xem phiếu trả F&B</a>}
        <span className="w-full text-xs text-muted-foreground">Phiếu trả tính theo ngày lập, kể cả khi hóa đơn gốc thuộc kỳ trước; số âm có thể xuất hiện trong kỳ.</span>
      </div>

      {/* CEO 13/05: 2 mode — Biểu đồ vs Bảng số liệu kế toán */}
      {viewMode === "chart" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
          {/* Revenue by Hour */}
          <ChartCard title="Doanh thu theo giờ" subtitle={`${selectedPeriodLabel} · Phân bổ trong ngày`}>
            <div className="h-64">
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
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
          <ChartCard title="Top 15 món bếp hoàn thành" subtitle={`${selectedPeriodLabel} · Giá món trước giảm giá; không phải doanh thu hóa đơn`}>
            <div className="h-64">
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
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
          <ChartCard title="Doanh thu theo bàn" subtitle={`${selectedPeriodLabel} · Xếp theo doanh thu`}>
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
          <ChartCard title="Hiệu suất nhân viên" subtitle={`${selectedPeriodLabel} · Doanh thu và số đơn`}>
            {cashiers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <ReportTableFrame tablePreferenceKey="report.fnb.daily">
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
              </ReportTableFrame>
            )}
          </ChartCard>
        </div>
      ) : (
        /* TABLE VIEW — 4 bảng số liệu kế toán đầy đủ */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
          {/* Doanh thu theo giờ */}
          <ChartCard title="Doanh thu theo giờ" subtitle={`${selectedPeriodLabel} · Phân bổ trong ngày`}>
            {hourly.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <ReportTableFrame tablePreferenceKey="report.fnb.products">
                <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Khung giờ</th>
                      <th className="py-2 px-3 font-medium text-right">Số đơn</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourly
                      .filter((h) => h.revenue > 0 || h.orders > 0)
                      .map((h, idx) => (
                        <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                          <td className="py-1.5 px-3 text-foreground tabular-nums">{h.label}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{h.orders}</td>
                          <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                            {formatCurrency(h.revenue)}đ
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {hourly.reduce((s, h) => s + h.orders, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(hourly.reduce((s, h) => s + h.revenue, 0))}đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </ReportTableFrame>
            )}
          </ChartCard>

          {/* Top món */}
          <ChartCard title="Top 15 món bếp hoàn thành" subtitle={`${selectedPeriodLabel} · Giá món trước giảm giá; không phải doanh thu hóa đơn`}>
            {menuItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <ReportTableFrame tablePreferenceKey="report.fnb.payment-methods">
                <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium w-8">#</th>
                      <th className="py-2 px-3 font-medium">Tên món</th>
                      <th className="py-2 px-3 font-medium text-right">SL</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuItems.map((m, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                        <td className="py-1.5 px-3 text-muted-foreground text-xs tabular-nums">{idx + 1}</td>
                        <td className="py-1.5 px-3 font-medium">{m.productName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{formatNumber(m.quantity)}</td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                          {formatCurrency(m.revenue)}đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td colSpan={2} className="py-2 px-3">CỘNG TOP 15</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {formatNumber(menuItems.reduce((s, m) => s + m.quantity, 0))}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(menuItems.reduce((s, m) => s + m.revenue, 0))}đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </ReportTableFrame>
            )}
          </ChartCard>

          {/* Doanh thu theo bàn */}
          <ChartCard title="Doanh thu theo bàn" subtitle={`${selectedPeriodLabel} · Xếp theo doanh thu`}>
            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <ReportTableFrame tablePreferenceKey="report.fnb.hours">
                <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Bàn</th>
                      <th className="py-2 px-3 font-medium text-right">Số đơn</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                        <td className="py-1.5 px-3 font-medium">{t.tableName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{t.orders}</td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                          {formatCurrency(t.revenue)}đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {tables.reduce((s, t) => s + t.orders, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(tables.reduce((s, t) => s + t.revenue, 0))}đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </ReportTableFrame>
            )}
          </ChartCard>

          {/* Cashier */}
          <ChartCard title="Hiệu suất nhân viên" subtitle={`${selectedPeriodLabel} · Doanh thu và số đơn`}>
            {cashiers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <ReportTableFrame tablePreferenceKey="report.fnb.order-types">
                <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Nhân viên</th>
                      <th className="py-2 px-3 font-medium text-right">Số đơn</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                      <th className="py-2 px-3 font-medium text-right">TB/đơn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashiers.map((c, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                        <td className="py-1.5 px-3 font-medium">{c.cashierName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{c.orders}</td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                          {formatCurrency(c.revenue)}đ
                        </td>
                        <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums">
                          {formatCurrency(c.avgTicket)}đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {cashiers.reduce((s, c) => s + c.orders, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(cashiers.reduce((s, c) => s + c.revenue, 0))}đ
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                </div>
              </ReportTableFrame>
            )}
          </ChartCard>
        </div>
      )}

      {viewMode === "table" && canViewInvoiceDetail && (
        <section className="px-4 pb-5" aria-labelledby="fnb-invoice-title">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="fnb-invoice-title" className="text-base font-semibold text-foreground">
                Chi tiết hóa đơn F&B
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedPeriodLabel} · Hóa đơn chưa hủy · {formatNumber(invoiceRows.length)} dòng đã tải
              </p>
            </div>
          </div>
          {invoiceError && (
            <div role="alert" className="mb-2 flex items-center gap-3 text-sm text-status-error">
              <span>{invoiceError}</span>
              <button type="button" className="font-medium underline" onClick={() => void loadInvoicePage(invoiceRows.length)}>
                Thử lại
              </button>
            </div>
          )}
          <ReportTableFrame tablePreferenceKey="report.fnb.invoice-details">
          <div className="overflow-x-auto border-y border-border">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-surface-container-low text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Hóa đơn</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Ngày chứng từ</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Khách hàng</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Trạng thái</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Thanh toán</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Tổng tiền</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Đã thu</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Còn nợ</th>
                </tr>
              </thead>
              <tbody>
                {invoiceRows.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-border last:border-b-0 hover:bg-surface-container-low">
                    <td className="px-3 py-2 font-medium text-primary"><a href={buildInvoiceListDeepLink(invoice.code)} className="underline-offset-2 hover:underline">{invoice.code}</a></td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{new Date(invoice.issuedAt).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2">{invoice.customerName}</td>
                    <td className="px-3 py-2">{{ draft: "Nháp", confirmed: "Đã xác nhận", completed: "Hoàn tất" }[invoice.status] ?? invoice.status}</td>
                    <td className="px-3 py-2">{{ cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Thẻ", mixed: "Kết hợp" }[invoice.paymentMethod] ?? invoice.paymentMethod}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(invoice.total)}đ</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(invoice.paid)}đ</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(invoice.debt)}đ</td>
                  </tr>
                ))}
                {!invoiceLoading && !invoiceError && invoiceRows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Không có hóa đơn trong kỳ đã chọn.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </ReportTableFrame>
          {(invoiceHasMore || invoiceLoading) && (
            <div className="mt-3 flex justify-center">
              <button type="button" disabled={invoiceLoading} onClick={() => void loadInvoicePage(invoiceRows.length)} className="h-9 rounded-md border border-border px-4 text-sm font-medium text-foreground disabled:opacity-60">
                {invoiceLoading ? "Đang tải..." : "Xem thêm 50 hóa đơn"}
              </button>
            </div>
          )}
        </section>
      )}
      {canViewInvoiceDetail && (
        <section className="px-4 pb-5" aria-labelledby="fnb-return-title">
          <h2 id="fnb-return-title" className="mb-1 text-base font-semibold text-foreground">Chi tiết phiếu trả F&B</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            {selectedPeriodLabel} · Chỉ phiếu trả của hóa đơn F&B · {formatNumber(returnRows.length)} dòng đã tải
          </p>
          {returnError && (
            <div role="alert" className="mb-2 flex items-center gap-3 text-sm text-status-error">
              <span>{returnError}</span>
              <button type="button" className="font-medium underline" onClick={() => void loadReturnPage(returnRows.length)}>Thử lại</button>
            </div>
          )}
          <ReportTableFrame tablePreferenceKey="report.fnb.return-details">
          <div className="overflow-x-auto border-y border-border">
            <table className="w-full min-w-[650px] text-sm">
              <thead className="bg-surface-container-low text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Phiếu trả</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Ngày lập</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Hóa đơn gốc</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Giá trị trả</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Đã hoàn tiền</th>
                </tr>
              </thead>
              <tbody>
                {returnRows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0 hover:bg-surface-container-low">
                    <td className="px-3 py-2 font-medium">{row.code}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{new Date(row.createdAt).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2 text-primary"><a href={buildInvoiceListDeepLink(row.invoiceCode)} className="underline-offset-2 hover:underline">{row.invoiceCode}</a></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.total)}đ</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.refunded)}đ</td>
                  </tr>
                ))}
                {!returnLoading && !returnError && returnRows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Không có phiếu trả F&B trong kỳ đã chọn.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </ReportTableFrame>
          {(returnHasMore || returnLoading) && (
            <div className="mt-3 flex justify-center">
              <button type="button" disabled={returnLoading} onClick={() => void loadReturnPage(returnRows.length)} className="h-9 rounded-md border border-border px-4 text-sm font-medium text-foreground disabled:opacity-60">
                {returnLoading ? "Đang tải..." : "Xem thêm 50 phiếu trả"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
