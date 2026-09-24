"use client";

/**
 * Báo cáo Trả hàng chi tiết (Phase B.1 — CEO 16/05/2026).
 *
 * Drill-down trả hàng theo lý do / SP / NV xử lý / chi nhánh.
 *
 * Trả lời câu hỏi quản lý:
 *   - Lý do trả hàng nào nhiều nhất? (chất lượng / khách đổi ý / sai món)
 *   - SP nào bị trả nhiều? (review chất lượng / mô tả sai)
 *   - Chi nhánh nào tỷ lệ trả hàng cao? (review nghiệp vụ cashier)
 *   - NV nào xử lý nhiều trả hàng? (review training)
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency, formatDate, formatChartCurrency } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  getSalesReturnReport,
  getDailyRevenue,
  type SalesReturnRow,
} from "@/lib/services";
import {
  summarizeSalesReturns,
  type ReturnDaySummary,
  type ReturnDocumentSummary,
  type ReturnReasonSummary,
} from "@/lib/reports/sales-return-summary";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";
import { buildReturnListDeepLink } from "@/lib/utils/return-list-deep-link";
import { LoadErrorState } from "@/components/shared/load-error-state";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

function chartLabel(value: string): string {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value;
}

export default function SalesReturnReportPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultViewMode: "table" });

  const [reportResult, setReportResult] = useState<{
    key: string;
    rows: SalesReturnRow[];
    periodRevenue: number;
    error: string | null;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [reasonFilter, setReasonFilter] = useState<string | "all">("all");
  const [tableMode, setTableMode] = useState<"day" | "document" | "item" | "reason">("day");
  const requestKey = `${activeBranchId ?? "all"}:${range.from}:${range.to}:${reloadToken}`;
  const loading = !isReady || reportResult?.key !== requestKey;
  const rows = useMemo(() => loading ? [] : reportResult.rows, [loading, reportResult]);
  const periodRevenue = loading ? 0 : reportResult.periodRevenue;
  const loadError = loading ? null : reportResult.error;

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    // Fetch song song: báo cáo trả hàng + tổng doanh thu cùng kỳ
    Promise.all([
      getSalesReturnReport({
        branchId: activeBranchId ?? null,
        dateFrom: range.from,
        dateTo: range.to,
      }),
      getDailyRevenue(0, activeBranchId ?? undefined, {
        from: range.from,
        to: range.to,
      }),
    ])
      .then(([returnRes, salesDays]) => {
        if (cancelled) return;
        setReportResult({
          key: requestKey,
          rows: returnRes.rows,
          periodRevenue: salesDays.reduce((sum, day) => sum + day.revenue, 0),
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setReportResult({
          key: requestKey,
          rows: [],
          periodRevenue: 0,
          error: err instanceof Error ? err.message : "Không tải được báo cáo trả hàng.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isReady, activeBranchId, range.from, range.to, requestKey]);

  const reasonOptions = useMemo(() => summarizeSalesReturns(rows).byReason, [rows]);
  const filteredRows = useMemo(() => {
    if (reasonFilter === "all") return rows;
    return rows.filter((r) => r.reason === reasonFilter);
  }, [rows, reasonFilter]);
  const summary = useMemo(() => summarizeSalesReturns(filteredRows), [filteredRows]);
  const { byDay, byDocument, byReason, byProduct, byStaff } = summary;
  const kpis = useMemo(() => ({
    ...summary,
    periodRevenue,
    returnRate: periodRevenue > 0 ? (summary.totalValue / periodRevenue) * 100 : null,
  }), [summary, periodRevenue]);

  // ── Columns ──
  const columns: DataTableColumn<SalesReturnRow>[] = [
    {
      label: "Ngày",
      key: "returnDate",
      width: "100px",
      cell: (r) => formatDate(r.returnDate),
    },
    { label: "Mã phiếu trả", key: "returnCode", width: "120px", cell: (r) => (
      <a href={buildReturnListDeepLink(r.returnCode)} className="font-medium text-primary underline-offset-2 hover:underline">{r.returnCode}</a>
    ) },
    {
      label: "Hoá đơn gốc",
      key: "invoiceCode",
      width: "120px",
      cell: (r) => r.invoiceCode
        ? <a href={buildInvoiceListDeepLink(r.invoiceCode)} className="font-medium text-primary underline-offset-2 hover:underline">{r.invoiceCode}</a>
        : "—",
    },
    { label: "Chi nhánh", key: "branchName", width: "140px" },
    { label: "Khách", key: "customerName", width: "160px" },
    { label: "Sản phẩm", key: "productName", width: "220px" },
    {
      label: "SL trả",
      key: "quantity",
      align: "right",
      cell: (r) => formatNumber(r.quantity),
    },
    {
      label: "Giá trị trả",
      key: "returnValue",
      align: "right",
      cell: (r) => (
        <span className="font-semibold tabular-nums text-status-warning">
          {formatCurrency(r.returnValue)}
        </span>
      ),
    },
    {
      label: "Lý do",
      key: "reason",
      width: "180px",
      cell: (r) => (
        <span className="text-xs px-2 py-0.5 rounded bg-status-warning/10 text-status-warning font-medium">
          {r.reason}
        </span>
      ),
    },
    {
      label: "NV xử lý",
      key: "createdByName",
      width: "140px",
      cell: (r) => r.createdByName ?? "—",
    },
  ];

  const dayColumns: DataTableColumn<ReturnDaySummary>[] = [
    { label: "Ngày trả", key: "date", hideable: false, cell: (row) => row.date.split("-").reverse().join("/") },
    { label: "Số phiếu", key: "returnCount", align: "right", cell: (row) => formatNumber(row.returnCount) },
    { label: "Dòng hàng", key: "productLines", align: "right", cell: (row) => formatNumber(row.productLines) },
    { label: "SL trả", key: "quantity", align: "right", cell: (row) => formatNumber(row.quantity) },
    { label: "Giá trị trả", key: "value", align: "right", cell: (row) => formatCurrency(row.value) + "đ" },
  ];

  const documentColumns: DataTableColumn<ReturnDocumentSummary>[] = [
    { label: "Ngày trả", key: "date", cell: (row) => formatDate(row.date) },
    { label: "Mã phiếu", key: "code", hideable: false, cell: (row) => (
      <a href={buildReturnListDeepLink(row.code)} className="font-medium text-primary underline-offset-2 hover:underline">{row.code}</a>
    ) },
    { label: "Hóa đơn gốc", key: "invoiceCode", cell: (row) => row.invoiceCode
      ? <a href={buildInvoiceListDeepLink(row.invoiceCode)} className="text-primary underline-offset-2 hover:underline">{row.invoiceCode}</a>
      : "—" },
    { label: "Chi nhánh", key: "branchName" },
    { label: "Khách", key: "customerName" },
    { label: "Lý do", key: "reason" },
    { label: "Dòng hàng", key: "productLines", align: "right", cell: (row) => formatNumber(row.productLines) },
    { label: "SL trả", key: "quantity", align: "right", cell: (row) => formatNumber(row.quantity) },
    { label: "Giá trị trả", key: "value", align: "right", cell: (row) => formatCurrency(row.value) + "đ" },
    { label: "NV xử lý", key: "staffName" },
  ];

  const reasonColumns: DataTableColumn<ReturnReasonSummary>[] = [
    { label: "Lý do trả hàng", key: "reason", hideable: false },
    { label: "Số phiếu", key: "count", align: "right", cell: (row) => formatNumber(row.count) },
    { label: "SL trả", key: "qty", align: "right", cell: (row) => formatNumber(row.qty) },
    { label: "Giá trị trả", key: "value", align: "right", cell: (row) => formatCurrency(row.value) + "đ" },
  ];

  // ── Export ──
  const handleExport = useCallback(() => {
    if (filteredRows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {

      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO TRẢ HÀNG CHI TIẾT",
        description: `Theo ngày, phiếu và dòng hàng. Lý do: ${reasonFilter === "all" ? "Tất cả" : reasonFilter}.`,
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Chỉ tính phiếu trả hàng đã chốt (status=completed/confirmed). Phiếu draft/cancelled không tính.",
      });

      const daySheet: ExcelSheet = {
        name: "Theo ngày",
        titleRows: ["TRẢ HÀNG THEO NGÀY"],
        columns: [
          { label: "Ngày trả", key: "date", width: 14 },
          { label: "Số phiếu", key: "returnCount", width: 14, format: "number" },
          { label: "Dòng hàng", key: "productLines", width: 14, format: "number" },
          { label: "SL trả", key: "quantity", width: 14, format: "number" },
          { label: "Giá trị trả", key: "value", width: 18, format: "currency" },
        ],
        rows: byDay.map((day) => ({ ...day, date: day.date.split("-").reverse().join("/") })),
        footer: { date: "TỔNG", returnCount: kpis.returnCount, productLines: filteredRows.length, quantity: kpis.totalQty, value: kpis.totalValue },
      };

      const documentSheet: ExcelSheet = {
        name: "Theo phiếu",
        titleRows: ["TRẢ HÀNG THEO PHIẾU"],
        columns: [
          { label: "Ngày trả", key: "date", width: 20 },
          { label: "Mã phiếu", key: "code", width: 16 },
          { label: "HĐ gốc", key: "invoiceCode", width: 16 },
          { label: "Chi nhánh", key: "branchName", width: 22 },
          { label: "Khách", key: "customerName", width: 24 },
          { label: "Lý do", key: "reason", width: 25 },
          { label: "Dòng hàng", key: "productLines", width: 14, format: "number" },
          { label: "SL trả", key: "quantity", width: 14, format: "number" },
          { label: "Giá trị trả", key: "value", width: 18, format: "currency" },
          { label: "NV xử lý", key: "staffName", width: 22 },
        ],
        rows: byDocument.map((document) => ({ ...document, date: formatDate(document.date) })),
        footer: { code: "TỔNG", productLines: filteredRows.length, quantity: kpis.totalQty, value: kpis.totalValue },
      };

      const reasonSheet: ExcelSheet = {
        name: "Theo lý do",
        titleRows: ["TRẢ HÀNG THEO LÝ DO"],
        columns: [
          { label: "Lý do", key: "reason", width: 28 },
          { label: "Số phiếu", key: "count", width: 14, format: "number" },
          { label: "SL trả", key: "qty", width: 14, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: byReason.map((r) => ({
          reason: r.reason,
          count: r.count,
          qty: r.qty,
          value: r.value,
        })),
        footer: {
          reason: "TỔNG",
          count: kpis.returnCount,
          qty: kpis.totalQty,
          value: kpis.totalValue,
        },
      };

      const productSheet: ExcelSheet = {
        name: "Theo sản phẩm",
        titleRows: ["TRẢ HÀNG THEO SẢN PHẨM"],
        columns: [
          { label: "Sản phẩm", key: "name", width: 32 },
          { label: "SL trả", key: "qty", width: 14, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: byProduct.map((r) => ({
          name: r.productName,
          qty: r.qty,
          value: r.value,
        })),
        footer: {
          name: "TỔNG",
          qty: kpis.totalQty,
          value: kpis.totalValue,
        },
      };

      const staffSheet: ExcelSheet = {
        name: "Theo NV",
        titleRows: ["TRẢ HÀNG THEO NHÂN VIÊN XỬ LÝ"],
        columns: [
          { label: "Nhân viên", key: "name", width: 24 },
          { label: "Số phiếu xử lý", key: "count", width: 16, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: byStaff.map((s) => ({
          name: s.name,
          count: s.count,
          value: s.value,
        })),
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết",
        titleRows: ["CHI TIẾT TỪNG DÒNG TRẢ HÀNG"],
        columns: [
          { label: "Ngày", key: "date", width: 12, format: "text" },
          { label: "Mã phiếu trả", key: "code", width: 14 },
          { label: "HĐ gốc", key: "invoice", width: 14 },
          { label: "Chi nhánh", key: "branch", width: 20 },
          { label: "Khách", key: "customer", width: 22 },
          { label: "Sản phẩm", key: "product", width: 28 },
          { label: "SL", key: "qty", width: 10, format: "number" },
          { label: "Đơn giá", key: "price", width: 14, format: "currency" },
          { label: "Giá trị", key: "value", width: 14, format: "currency" },
          { label: "Lý do", key: "reason", width: 24 },
          { label: "NV", key: "staff", width: 20 },
        ],
        rows: filteredRows.map((r) => ({
          date: formatDate(r.returnDate),
          code: r.returnCode,
          invoice: r.invoiceCode ?? "",
          branch: r.branchName ?? "",
          customer: r.customerName,
          product: r.productName,
          qty: r.quantity,
          price: r.unitPrice,
          value: r.returnValue,
          reason: r.reason,
          staff: r.createdByName ?? "",
        })),
        footer: {
          date: "",
          code: "",
          invoice: "",
          branch: "",
          customer: "",
          product: `${filteredRows.length} dòng`,
          qty: kpis.totalQty,
          price: "",
          value: kpis.totalValue,
          reason: "",
          staff: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "tra-hang",
        mode: "full",
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        sheets: [infoSheet, daySheet, documentSheet, reasonSheet, productSheet, staffSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo trả hàng",
        description: `7 sheet, ${kpis.returnCount} phiếu và ${filteredRows.length} dòng hàng theo bộ lọc hiện tại`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [filteredRows, byDay, byDocument, byReason, byProduct, byStaff, kpis, range, branchLabel, reasonFilter, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Trả hàng chi tiết"
      subtitle="Đối chiếu theo ngày, phiếu và mặt hàng; mở chứng từ gốc từ bảng chi tiết"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportFull={handleExport}
      exportDisabled={loading || Boolean(loadError) || filteredRows.length === 0}
    />
  );

  if (loadError) {
    return (
      <div className="p-3 md:p-5 space-y-4">
        {reportHeader}
        <LoadErrorState
          title="Không tải được báo cáo trả hàng"
          description={`${loadError} Không hiển thị tỷ lệ 0% khi doanh thu chưa tải được.`}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-3 md:p-5 space-y-4">
        {reportHeader}
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Icon name="progress_activity" size={20} className="animate-spin" />
          Đang tải báo cáo trả hàng...
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-5 space-y-4">
      {reportHeader}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Giá trị trả / bán gộp"
          value={kpis.returnRate === null ? "—" : `${kpis.returnRate.toFixed(2)}%`}
          change={kpis.returnRate === null
            ? "Chưa có doanh thu cùng kỳ"
            : `${formatCurrency(kpis.totalValue)}đ trả / ${formatCurrency(kpis.periodRevenue)}đ bán gộp cùng kỳ`}
          positive={kpis.returnRate !== null && kpis.returnRate < 2}
          icon="percent"
          bg={
            (kpis.returnRate ?? 0) > 5
              ? "bg-status-error/10"
              : (kpis.returnRate ?? 0) > 2
                ? "bg-status-warning/10"
                : "bg-status-success/10"
          }
          iconColor={
            (kpis.returnRate ?? 0) > 5
              ? "text-status-error"
              : (kpis.returnRate ?? 0) > 2
                ? "text-status-warning"
                : "text-status-success"
          }
          valueColor={
            (kpis.returnRate ?? 0) > 5
              ? "text-status-error"
              : (kpis.returnRate ?? 0) > 2
                ? "text-status-warning"
                : "text-status-success"
          }
        />
        <KpiCard
          label="Tổng giá trị trả"
          value={formatCurrency(kpis.totalValue) + " đ"}
          icon="undo"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label="Số phiếu trả"
          value={formatNumber(kpis.returnCount)}
          change={`${kpis.productCount} SP / ${formatNumber(kpis.totalQty)} SL`}
          positive
          icon="receipt_long"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Bán gộp cùng kỳ"
          value={formatCurrency(kpis.periodRevenue) + " đ"}
          icon="payments"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
      </div>

      {viewMode === "chart" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Trả hàng theo lý do"
            subtitle="Top lý do giá trị cao"
          >
            <div className="h-72">
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byReason.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={formatChartCurrency}
                  />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    fontSize={11}
                    width={140}
                    tickFormatter={chartLabel}
                  />
                  <Tooltip
                    formatter={(v: unknown) =>
                      formatCurrency(Number(v) || 0) + " đ"
                    }
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {byReason.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            title="Top sản phẩm bị trả"
            subtitle="Theo giá trị"
          >
            <div className="h-72">
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byProduct.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={formatChartCurrency}
                  />
                  <YAxis
                    type="category"
                    dataKey="productName"
                    fontSize={10}
                    width={140}
                    tickFormatter={chartLabel}
                  />
                  <Tooltip
                    formatter={(v: unknown) =>
                      formatCurrency(Number(v) || 0) + " đ"
                    }
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      <section className="border border-border bg-background">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Số liệu trả hàng</h2>
            <p className="text-sm text-muted-foreground">{kpis.returnCount} phiếu, {filteredRows.length} dòng hàng trong bộ lọc.</p>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Lý do trả hàng
            <select
              value={reasonFilter}
              onChange={(event) => setReasonFilter(event.target.value)}
              className="h-9 min-w-48 max-w-72 border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="all">Tất cả lý do ({rows.length} dòng)</option>
              {reasonOptions.map((reason) => (
                <option key={reason.reason} value={reason.reason}>
                  {reason.reason} ({reason.count} phiếu)
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2" role="tablist" aria-label="Góc nhìn trả hàng">
          {([
            ["day", "Theo ngày"],
            ["document", "Theo phiếu"],
            ["item", "Dòng hàng"],
            ["reason", "Theo lý do"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={tableMode === mode}
              onClick={() => setTableMode(mode)}
              className={tableMode === mode
                ? "bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"}
            >
              {label}
            </button>
          ))}
        </div>
        {tableMode === "day" ? (
          <ReportDataTable
            tablePreferenceKey="report.sales-returns.daily"
            columns={dayColumns}
            rows={byDay}
            getRowKey={(row) => row.date}
            subtotalLabel={`${kpis.returnCount} phiếu · ${formatCurrency(kpis.totalValue)}đ giá trị trả`}
            emptyState="Không có phiếu trả hàng trong kỳ hoặc bộ lọc đã chọn"
          />
        ) : tableMode === "document" ? (
          <ReportDataTable
            tablePreferenceKey="report.sales-returns.documents"
            columns={documentColumns}
            rows={byDocument}
            getRowKey={(row) => row.id}
            subtotalLabel={`${kpis.returnCount} phiếu · ${formatCurrency(kpis.totalValue)}đ giá trị trả`}
            emptyState="Không có phiếu trả hàng trong kỳ hoặc bộ lọc đã chọn"
          />
        ) : tableMode === "item" ? (
          <ReportDataTable
            tablePreferenceKey="report.sales-returns.rows"
            columns={columns}
            rows={filteredRows}
            getRowKey={(row, index) => `${row.returnId}-${row.productId}-${index}`}
            subtotalLabel={`${filteredRows.length} dòng · ${formatCurrency(kpis.totalValue)}đ giá trị trả`}
            emptyState="Không có dòng hàng trả trong kỳ hoặc bộ lọc đã chọn"
          />
        ) : (
          <ReportDataTable
            tablePreferenceKey="report.sales-returns.reasons"
            columns={reasonColumns}
            rows={byReason}
            getRowKey={(row) => row.reason}
            subtotalLabel={`${kpis.returnCount} phiếu · ${formatCurrency(kpis.totalValue)}đ giá trị trả`}
            emptyState="Không có lý do trả hàng trong kỳ hoặc bộ lọc đã chọn"
          />
        )}
      </section>
    </div>
  );
}
