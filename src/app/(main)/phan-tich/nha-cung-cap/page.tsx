"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { ReportDataTable, ReportPageHeader, ReportTableFrame, type DataTableColumn } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useDebounce } from "@/lib/utils/use-debounce";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { PERMISSIONS } from "@/lib/permissions/constants";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  formatCurrency,
  formatDate,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getSupplierKpis,
  getPurchaseByMonth,
  getTopSuppliersByPurchase,
  getSupplierPaymentStatus,
  getSupplierSummary,
  getPurchaseOrders,
} from "@/lib/services";
import type { PurchaseOrder } from "@/lib/types";
import type {
  ChartPoint,
  SupplierSummaryRow,
} from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";
import { formatSelectedPeriodLabel } from "@/lib/utils/date-presets";

// === Helpers ===

const PAYMENT_COLORS = ["#16a34a", "#f59e0b", "#ef4444"];
const VOUCHER_SORTS = {
  recent: { sortBy: "created_at", sortOrder: "desc" },
  oldest: { sortBy: "created_at", sortOrder: "asc" },
  total: { sortBy: "total", sortOrder: "desc" },
  paid: { sortBy: "paid", sortOrder: "desc" },
  debt: { sortBy: "debt", sortOrder: "desc" },
  supplier: { sortBy: "supplier_name", sortOrder: "asc" },
} as const;

function truncateAxisLabel(value: string, maxLength: number = 24): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function calcChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% so với kỳ trước`;
}

// === Custom Tooltips ===

function PurchaseTooltip({
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
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function SupplierAmountTooltip({
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
      <p className="text-sm font-bold text-status-warning">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function PaymentTooltip({
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

export default function NhaCungCapPage() {
  const { activeBranchId, branchLabel, branches, isReady } = useBranchFilter();
  const { hasPermission } = useAuth();
  const canViewDetail = hasPermission(PERMISSIONS.REPORTS_VIEW_DETAIL);
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<{
    totalSuppliers: number;
    purchaseThisMonth: number;
    prevPurchase: number;
    totalDebt: number;
    prevDebt: number;
    returnCount: number;
  } | null>(null);
  const [purchaseByMonth, setPurchaseByMonth] = useState<ChartPoint[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<{ name: string; amount: number }[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<{ name: string; value: number }[]>([]);
  const [supplierTable, setSupplierTable] = useState<SupplierSummaryRow[]>([]);
  const [tableMode, setTableMode] = useState<"vouchers" | "suppliers">("vouchers");
  const [voucherSearch, setVoucherSearch] = useState("");
  const [voucherSort, setVoucherSort] = useState<keyof typeof VOUCHER_SORTS>("recent");
  const debouncedVoucherSearch = useDebounce(voucherSearch, 300);
  const [vouchers, setVouchers] = useState<PurchaseOrder[]>([]);
  const [voucherPage, setVoucherPage] = useState(0);
  const [voucherTotal, setVoucherTotal] = useState(0);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const voucherRequestIdRef = useRef(0);
  const selectedPeriodLabel = formatSelectedPeriodLabel(preset, range);

  const voucherColumns: DataTableColumn<PurchaseOrder>[] = [
    {
      label: "Mã phiếu", key: "code", sortable: false,
      cell: (row) => <a className="font-medium text-primary hover:underline" href={`/hang-hoa/nhap-hang?search=${encodeURIComponent(row.code)}`}>{row.code}</a>,
    },
    { label: "Ngày tạo", key: "date", sortable: false, cell: (row) => formatDate(row.date) },
    { label: "Nhà cung cấp", key: "supplierName", sortable: false },
    { label: "Chi nhánh", key: "branchId", sortable: false,
      cell: (row) => branches.find((branch) => branch.id === row.branchId)?.name ?? "—" },
    { label: "Tổng phiếu", key: "total", align: "right", sortable: false, cell: (row) => formatCurrency(row.total) + "đ" },
    { label: "Đã trả", key: "paid", align: "right", sortable: false, cell: (row) => formatCurrency(row.paid) + "đ" },
    { label: "Còn nợ", key: "amountOwed", align: "right", sortable: false, cell: (row) => formatCurrency(row.amountOwed) + "đ" },
  ];

  const fetchVouchers = useCallback(async (page: number, append = false) => {
    const requestId = ++voucherRequestIdRef.current;
    setVoucherLoading(true);
    setVoucherError(null);
    try {
      const result = await getPurchaseOrders({
        page, pageSize: 50, search: debouncedVoucherSearch,
        ...VOUCHER_SORTS[voucherSort],
        branchId: activeBranchId,
        filters: { status: "completed", dateFrom: range.from, dateTo: range.to },
      });
      if (requestId !== voucherRequestIdRef.current) return;
      setVouchers((current) => append ? [...current, ...result.data] : result.data);
      setVoucherPage(page);
      setVoucherTotal(result.total);
    } catch (error) {
      if (requestId === voucherRequestIdRef.current) {
        setVoucherError(error instanceof Error ? error.message : "Không tải được phiếu nhập.");
      }
    } finally {
      if (requestId === voucherRequestIdRef.current) setVoucherLoading(false);
    }
  }, [activeBranchId, debouncedVoucherSearch, range, voucherSort]);

  useEffect(() => {
    if (!isReady || !canViewDetail || viewMode !== "table" || tableMode !== "vouchers") return;
    setVouchers([]);
    setVoucherTotal(0);
    void fetchVouchers(0);
    return () => { voucherRequestIdRef.current += 1; };
  }, [canViewDetail, fetchVouchers, isReady, tableMode, viewMode]);


  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO NHÀ CUNG CẤP",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = viewMode === "table" && tableMode === "vouchers" && canViewDetail ? {
        name: "Phiếu nhập đã tải",
        titleRows: title,
        columns: [
          { label: "Mã phiếu", key: "code", width: 16 },
          { label: "Ngày tạo", key: "date", width: 20 },
          { label: "Nhà cung cấp", key: "supplierName", width: 32 },
          { label: "Chi nhánh", key: "branchName", width: 28 },
          { label: "Tổng phiếu", key: "total", width: 18, format: "currency" },
          { label: "Đã trả", key: "paid", width: 18, format: "currency" },
          { label: "Còn nợ", key: "debt", width: 18, format: "currency" },
        ],
        rows: vouchers.map((order) => ({
          code: order.code, date: order.date, supplierName: order.supplierName,
          branchName: branches.find((branch) => branch.id === order.branchId)?.name ?? "",
          total: order.total, paid: order.paid, debt: order.amountOwed,
        })),
      } : {
        name: "Tổng quan NCC",
        titleRows: title,
        columns: [
          { label: "Nhà cung cấp", key: "name", width: 32 },
          { label: "Đã mua (VND)", key: "purchased", width: 18, format: "currency" },
          { label: "Công nợ (VND)", key: "debt", width: 18, format: "currency" },
          { label: "Đơn nhập", key: "orderCount", width: 12, format: "number" },
        ],
        rows: supplierTable.map((s) => ({
          name: s.name,
          purchased: s.total,
          debt: s.debt,
          orderCount: s.orders,
        })),
        footer: {
          name: "TỔNG",
          purchased: supplierTable.reduce((sum, s) => sum + s.total, 0),
          debt: supplierTable.reduce((sum, s) => sum + s.debt, 0),
          orderCount: supplierTable.reduce((sum, s) => sum + s.orders, 0),
        },
      };
      exportReportToExcel({ kind: "nha-cung-cap", mode: "view", range, branchName: branchLabel, sheets: [sheet] });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({ title: "Lỗi xuất Excel", description: err instanceof Error ? err.message : "", variant: "error" });
    }
  }, [supplierTable, vouchers, range, branchLabel, branches, toast, viewMode, tableMode, canViewDetail]);

  const handleExportFull = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [allTopSuppliers, allSupplierRows] = await Promise.all([
        getTopSuppliersByPurchase(null, activeBranchId, range),
        getSupplierSummary(null, activeBranchId, range),
      ]);
      const title = buildReportTitleRows({
        title: "BÁO CÁO NHÀ CUNG CẤP — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        {
          name: "KPI",
          titleRows: title,
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 28 },
            { label: "Giá trị", key: "value", width: 18 },
          ],
          rows: [
            { metric: "Tổng NCC", value: kpis?.totalSuppliers ?? 0 },
            { metric: "Mua trong kỳ", value: kpis?.purchaseThisMonth ?? 0 },
            { metric: "Mua kỳ trước", value: kpis?.prevPurchase ?? 0 },
            { metric: "Tổng công nợ", value: kpis?.totalDebt ?? 0 },
            { metric: "Số đơn trả", value: kpis?.returnCount ?? 0 },
          ],
        },
        {
          name: "Mua theo tháng",
          titleRows: ["GIÁ TRỊ MUA HÀNG TRONG KỲ", ...title.slice(1)],
          columns: [
            { label: "Tháng", key: "label", width: 16 },
            { label: "Giá trị (VND)", key: "value", width: 18, format: "currency" },
          ],
          rows: purchaseByMonth.map((p) => ({ label: p.label, value: p.value })),
        },
        {
          name: "Top NCC",
          titleRows: ["TẤT CẢ NHÀ CUNG CẤP", ...title.slice(1)],
          columns: [
            { label: "Nhà cung cấp", key: "name", width: 32 },
            { label: "Tổng mua (VND)", key: "amount", width: 18, format: "currency" },
          ],
          rows: allTopSuppliers,
        },
        {
          name: "Chi tiết NCC",
          titleRows: ["TỔNG HỢP NCC", ...title.slice(1)],
          columns: [
            { label: "Nhà cung cấp", key: "name", width: 32 },
            { label: "Đã mua (VND)", key: "purchased", width: 18, format: "currency" },
            { label: "Công nợ (VND)", key: "debt", width: 18, format: "currency" },
            { label: "Đơn nhập", key: "orderCount", width: 12, format: "number" },
          ],
          rows: allSupplierRows.map((s) => ({
            name: s.name, purchased: s.total, debt: s.debt, orderCount: s.orders,
          })),
        },
        {
          name: "Tình trạng TT",
          titleRows: ["TÌNH TRẠNG THANH TOÁN", ...title.slice(1)],
          columns: [
            { label: "Trạng thái", key: "name", width: 20 },
            { label: "Số NCC", key: "value", width: 12, format: "number" },
          ],
          rows: paymentStatus,
        },
      ];
      if (canViewDetail) {
        const allVouchers: PurchaseOrder[] = [];
        for (let page = 0; ; page += 1) {
          const result = await getPurchaseOrders({
            page, pageSize: 1000, search: debouncedVoucherSearch,
            ...VOUCHER_SORTS[voucherSort],
            branchId: activeBranchId,
            filters: { status: "completed", dateFrom: range.from, dateTo: range.to },
          });
          allVouchers.push(...result.data);
          if (!result.data.length || allVouchers.length >= result.total) break;
        }
        sheets.push({
          name: "Phiếu nhập trong kỳ",
          titleRows: ["PHIẾU NHẬP HOÀN THÀNH", ...title.slice(1)],
          columns: [
            { label: "Mã phiếu", key: "code", width: 16 },
            { label: "Ngày tạo", key: "date", width: 20 },
            { label: "Nhà cung cấp", key: "supplierName", width: 32 },
            { label: "Chi nhánh", key: "branchName", width: 28 },
            { label: "Tổng phiếu", key: "total", width: 18, format: "currency" },
            { label: "Đã trả", key: "paid", width: 18, format: "currency" },
            { label: "Còn nợ", key: "debt", width: 18, format: "currency" },
          ],
          rows: allVouchers.map((order) => ({
            code: order.code, date: order.date, supplierName: order.supplierName,
            branchName: branches.find((branch) => branch.id === order.branchId)?.name ?? "",
            total: order.total, paid: order.paid, debt: order.amountOwed,
          })),
        });
      }
      await exportReportToExcel({ kind: "nha-cung-cap", mode: "full", range, branchName: branchLabel, sheets });
      toast({ title: "Đã xuất Excel (đầy đủ)", variant: "success" });
    } catch (err) {
      toast({ title: "Lỗi xuất Excel", description: err instanceof Error ? err.message : "", variant: "error" });
    } finally {
      setExporting(false);
    }
  }, [activeBranchId, kpis, purchaseByMonth, paymentStatus, range, branchLabel, branches, debouncedVoucherSearch, voucherSort, canViewDetail, exporting, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Mua hàng theo nhà cung cấp"
      subtitle="Thống kê mua hàng và công nợ nhà cung cấp"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || exporting || !!loadError}
    />
  );

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setLoadError(null);
      const [kpiData, purchase, top, payment, summary] = await Promise.all([
        getSupplierKpis(activeBranchId, range),
        getPurchaseByMonth(6, activeBranchId, range),
        getTopSuppliersByPurchase(5, activeBranchId, range),
        getSupplierPaymentStatus(activeBranchId),
        getSupplierSummary(null, activeBranchId, range),
      ]);
      if (requestId !== requestIdRef.current) return;
      setKpis(kpiData);
      setPurchaseByMonth(purchase);
      setTopSuppliers(top);
      setPaymentStatus(payment);
      setSupplierTable(summary);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(err instanceof Error ? err.message : "Không tải được báo cáo nhà cung cấp.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {loadError && (
          <div role="alert" className="border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {loadError}
          </div>
        )}
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="NCC đã giao dịch"
            value={String(kpis?.totalSuppliers ?? 0)}
            change={`${kpis?.totalSuppliers ?? 0} nhà cung cấp`}
            positive
            icon="local_shipping"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tổng mua trong kỳ"
            value={formatCurrency(kpis?.purchaseThisMonth ?? 0)}
            change={calcChange(kpis?.purchaseThisMonth ?? 0, kpis?.prevPurchase ?? 0)}
            positive={(kpis?.purchaseThisMonth ?? 0) >= (kpis?.prevPurchase ?? 0)}
            icon="shopping_bag"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Công nợ NCC"
            value={formatCurrency(kpis?.totalDebt ?? 0)}
            change="Dư nợ tại thời điểm hiện tại"
            positive={(kpis?.totalDebt ?? 0) === 0}
            icon="account_balance_wallet"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Trả hàng NCC"
            value={String(kpis?.returnCount ?? 0)}
            change={`${kpis?.returnCount ?? 0} phiếu trả hàng`}
            positive={false}
            icon="undo"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
        </div>

        {viewMode === "chart" && <><div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Purchase volume by month */}
          <ChartCard title="Giá trị mua hàng theo tháng" subtitle={selectedPeriodLabel}>
            <div className="h-64">
              {purchaseByMonth.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Chưa có dữ liệu mua hàng
                </div>
              ) : (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                  <LineChart
                    data={purchaseByMonth}
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
                    <Tooltip content={<PurchaseTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#004AC6"
                      strokeWidth={2}
                      dot={{ fill: "#004AC6", r: 4 }}
                      activeDot={{ r: 6, fill: "#004AC6" }}
                      name="Giá trị mua"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </ChartCard>

          {/* Top 5 suppliers horizontal bar */}
          <ChartCard title="Top 5 nhà cung cấp" subtitle={`${selectedPeriodLabel} · Theo giá trị mua hàng`}>
            <div className="h-64">
              {topSuppliers.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Chưa có dữ liệu nhà cung cấp
                </div>
              ) : (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart
                    data={[...topSuppliers].reverse()}
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
                      tickFormatter={(value: string) => truncateAxisLabel(value)}
                    />
                    <Tooltip content={<SupplierAmountTooltip />} />
                    <Bar
                      dataKey="amount"
                      fill="#ea580c"
                      radius={[0, 6, 6, 0]}
                      name="Giá trị mua"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </ChartCard>
        </div>

        {/* Payment status pie chart */}
        <ChartCard title="Tình trạng thanh toán NCC" subtitle="Dư nợ tại thời điểm hiện tại">
          <div className="h-72">
            {paymentStatus.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Chưa có dữ liệu thanh toán
              </div>
            ) : (
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={paymentStatus}
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
                    {paymentStatus.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PAYMENT_COLORS[index % PAYMENT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PaymentTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    formatter={(value: string) => (
                      <span className="text-xs">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>
        </>}

        {viewMode === "table" && <section className="border border-border bg-surface-container-lowest">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Mua hàng nhà cung cấp</h2>
              <p className="text-sm text-muted-foreground">{selectedPeriodLabel} · {branchLabel}</p>
              <p className="text-xs text-muted-foreground">Ngày lọc theo lúc tạo phiếu; đã trả và còn nợ là số hiện tại của phiếu.</p>
            </div>
            <div className="flex border border-border" role="group" aria-label="Góc nhìn báo cáo nhà cung cấp">
              {canViewDetail && <button type="button" onClick={() => setTableMode("vouchers")}
                className={tableMode === "vouchers" ? "bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground" : "px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"}>
                Theo phiếu nhập
              </button>}
              <button type="button" onClick={() => setTableMode("suppliers")}
                className={tableMode === "suppliers" ? "bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground" : "px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"}>
                Theo nhà cung cấp
              </button>
            </div>
          </div>
          {tableMode === "vouchers" && canViewDetail ? <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input type="search" aria-label="Tìm mã phiếu hoặc nhà cung cấp"
                  className="h-9 w-full max-w-sm border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  placeholder="Tìm mã phiếu hoặc nhà cung cấp" value={voucherSearch}
                  onChange={(event) => setVoucherSearch(event.target.value)} />
                <select aria-label="Sắp xếp phiếu nhập" className="h-9 border border-border bg-background px-2 text-sm"
                  value={voucherSort} onChange={(event) => setVoucherSort(event.target.value as keyof typeof VOUCHER_SORTS)}>
                  <option value="recent">Mới nhất</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="total">Tổng phiếu cao nhất</option>
                  <option value="paid">Đã trả cao nhất</option>
                  <option value="debt">Còn nợ cao nhất</option>
                  <option value="supplier">Tên NCC A–Z</option>
                </select>
              </div>
              <span className="text-sm text-muted-foreground">{voucherTotal} phiếu hoàn thành</span>
            </div>
            {voucherError ? <div role="alert" className="py-6 text-sm text-destructive">{voucherError}</div> : voucherLoading && !vouchers.length ? (
              <div className="py-8 text-sm text-muted-foreground">Đang tải phiếu nhập...</div>
            ) : <ReportDataTable<PurchaseOrder>
              columns={voucherColumns}
              tablePreferenceKey="report.suppliers.purchase-vouchers"
              rows={vouchers}
              getRowKey={(row) => row.id}
              subtotalLabel={`Đã tải ${vouchers.length} / ${voucherTotal} phiếu`}
              emptyState="Không có phiếu nhập hoàn thành khớp bộ lọc"
              paginationThreshold={100}
            />}
            {vouchers.length < voucherTotal && <button type="button" disabled={voucherLoading}
              onClick={() => void fetchVouchers(voucherPage + 1, true)}
              className="mt-3 border border-border px-3 py-2 text-sm font-medium text-primary disabled:opacity-50">
              {voucherLoading ? "Đang tải..." : "Tải thêm phiếu nhập"}
            </button>}
          </div> : <div className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Tổng hợp theo nhà cung cấp</h3>
          {supplierTable.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có dữ liệu nhà cung cấp
            </div>
          ) : (
            <ReportTableFrame tablePreferenceKey="report.suppliers.summary">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">#</th>
                    <th className="text-left py-2 pr-4 font-medium">NCC</th>
                    <th className="text-right py-2 pr-4 font-medium">Tổng mua</th>
                    <th className="text-right py-2 pr-4 font-medium">Công nợ</th>
                    <th className="text-right py-2 font-medium">Số đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierTable.map((item) => (
                    <tr key={item.rank} className="border-b last:border-0">
                      <td className="py-3 pr-4 text-muted-foreground">{item.rank}</td>
                      <td className="py-3 pr-4 font-medium">{item.name}</td>
                      <td className="py-3 pr-4 text-right font-medium text-primary">
                        {formatCurrency(item.total)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {item.debt > 0 ? (
                          <span className="text-status-error font-medium">{formatCurrency(item.debt)}</span>
                        ) : (
                          <span className="text-status-success">0</span>
                        )}
                      </td>
                      <td className="py-3 text-right">{item.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </ReportTableFrame>
          )}
          </div>}
        </section>}
      </div>
    </div>
  );
}
