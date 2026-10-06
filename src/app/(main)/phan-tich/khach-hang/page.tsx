"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { customerReportRows, debtorReportRows, type CustomerSort, type SortDirection } from "@/lib/reports/management-table-view";
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
import { useBranchFilter, useToast } from "@/lib/contexts";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
  formatNumber,
} from "@/lib/format";
import {
  getCustomerKpis,
  getNewCustomersMonthly,
  getCustomerSegments,
  getTopCustomersByRevenue,
  getTopDebtors,
  getCustomers,
} from "@/lib/services";
import type {
  ChartPoint,
  CustomerSegment,
  TopCustomer,
  TopDebtor,
} from "@/lib/services/supabase/analytics";
import type { Customer } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { useAuth } from "@/lib/contexts";

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
        {formatNumber(payload[0].value)} khách mới
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
      <p className="text-sm font-bold">{formatNumber(payload[0].value)} khách hàng</p>
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

async function loadAllCustomersForExport(): Promise<Customer[]> {
  const rows: Customer[] = [];
  const pageSize = 500;
  for (let page = 0; ; page++) {
    const result = await getCustomers({
      page,
      pageSize,
      sortBy: "name",
      sortOrder: "asc",
    });
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
}

export default function KhachHangPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerGroup, setCustomerGroup] = useState("");
  const [customerSort, setCustomerSort] = useState<CustomerSort>("revenue");
  const [customerDirection, setCustomerDirection] = useState<SortDirection>("desc");
  const [customerPage, setCustomerPage] = useState(0);
  const [debtSearch, setDebtSearch] = useState("");
  const [debtSort, setDebtSort] = useState<"name" | "debt">("debt");
  const [debtDirection, setDebtDirection] = useState<SortDirection>("desc");
  const visibleDebtors = useMemo(() => debtorReportRows(topDebtors, debtSearch, debtSort, debtDirection), [topDebtors, debtSearch, debtSort, debtDirection]);
  const visibleCustomers = useMemo(() => customerReportRows(topCustomers, customerSearch, customerSort, customerDirection, customerGroup), [topCustomers, customerSearch, customerSort, customerDirection, customerGroup]);
  const customerGroups = [...new Set([...topCustomers.map(row => row.groupName ?? "Chưa phân nhóm"), ...(customerGroup ? [customerGroup] : [])])].sort((a, b) => a.localeCompare(b, "vi"));
  const pageCount = Math.max(1, Math.ceil(visibleCustomers.length / 50));
  const currentPage = Math.min(customerPage, pageCount - 1);
  const pagedCustomers = visibleCustomers.slice(currentPage * 50, (currentPage + 1) * 50);
  const requestIdRef = useRef(0);
  const tenantName = useAuth().tenant?.name;

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setLoadError(null);
      const [kpiData, monthly, segments, customers, debtors] = await Promise.all([
        getCustomerKpis(activeBranchId, range),
        getNewCustomersMonthly(6, activeBranchId),
        getCustomerSegments(activeBranchId),
        // P1-3B-R6 13/06/2026: truyền range để top 50 KH theo đúng kỳ (trước đây lifetime).
        getTopCustomersByRevenue(null, activeBranchId, range),
        getTopDebtors(null, activeBranchId),
      ]);
      if (requestId !== requestIdRef.current) return;
      const currentDebt = debtors.reduce((sum, row) => sum + row.debt, 0);
      setKpis({ ...kpiData, totalDebt: currentDebt, prevTotalDebt: currentDebt });
      setNewCustomersMonthly(monthly);
      setCustomerSegments(segments);
      setTopCustomers(customers);
      setTopDebtors(debtors);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Failed to fetch customer analytics:", err);
      setLoadError(err instanceof Error ? err.message : "Không tải được báo cáo khách hàng.");
      setTopCustomers([]);
      setTopDebtors([]);
      setKpis(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  const handleExportView = useCallback(async () => {
    if (!kpis || exporting) return;
    setExporting(true);
    try {
    const titleRows = buildReportTitleRows({
      title: "Báo cáo khách hàng",
      range,
      branchName,
      generatedAt: new Date(),
    });
    await exportReportToExcel({
      kind: "khach-hang",
      mode: "view",
      range,
      branchName,
      sheets: [
        {
          name: "Doanh thu khách hàng",
          titleRows,
          columns: [
            { label: "Hạng", key: "rank", width: 6, format: "number" },
            { label: "Khách hàng", key: "name", width: 28 },
            { label: "Mã khách", key: "code", width: 18 },
            { label: "Nhóm khách", key: "groupName", width: 24 },
            { label: "Số đơn", key: "orders", width: 10, format: "number" },
            { label: "Doanh thu bán trước trả hàng", key: "revenue", width: 26, format: "currency" },
            { label: "Bình quân/đơn", key: "average", width: 18, format: "currency" },
          ],
          rows: visibleCustomers.map((c) => ({
            rank: c.rank,
            name: c.name,
            code: c.code ?? "",
            groupName: c.groupName ?? "Chưa phân nhóm",
            orders: c.orders,
            revenue: c.revenue,
            average: c.orders ? c.revenue / c.orders : 0,
          })),
          footer: { name: "Tổng kết quả lọc", orders: visibleCustomers.reduce((sum, c) => sum + c.orders, 0), revenue: visibleCustomers.reduce((sum, c) => sum + c.revenue, 0) },
        },
        { name: "Công nợ đã lọc", columns: [{ label: "Khách hàng", key: "name", width: 30 }, { label: "Công nợ hiện tại", key: "debt", width: 22, format: "currency" }], rows: visibleDebtors.map(row => ({ ...row })), footer: { name: "Tổng kết quả lọc", debt: visibleDebtors.reduce((sum, row) => sum + row.debt, 0) } },
      ],
    });
    } catch (error) {
      toast({ title: "Không xuất được báo cáo khách hàng", description: error instanceof Error ? error.message : "Vui lòng thử lại.", variant: "error" });
    } finally { setExporting(false); }
  }, [kpis, visibleCustomers, visibleDebtors, range, branchName, exporting, toast]);

  const handleExportFull = useCallback(async () => {
    if (!kpis || exporting) return;
    setExporting(true);
    try {

    const [allCustomers, allRevenueCustomers, allDebtors] = await Promise.all([
      loadAllCustomersForExport(),
      getTopCustomersByRevenue(null, activeBranchId, range),
      getTopDebtors(null, activeBranchId),
    ]);
    const scopedCustomerIds = new Set(
      allRevenueCustomers.map((customer) => customer.customerId),
    );
    const filteredRevenueCustomers = customerReportRows(allRevenueCustomers, customerSearch, customerSort, customerDirection, customerGroup);
    const filteredDebtors = debtorReportRows(allDebtors, debtSearch, debtSort, debtDirection);
    const customerList = allCustomers.filter(customer => (!activeBranchId || scopedCustomerIds.has(customer.id))
      && `${customer.name} ${customer.code}`.toLocaleLowerCase("vi").includes(customerSearch.trim().toLocaleLowerCase("vi"))
      && (!customerGroup || (customer.groupName ?? "Chưa phân nhóm") === customerGroup));

    // Sheet 0: Info
    const infoSheet = buildInfoSheet({
      title: "BÁO CÁO PHÂN TÍCH KHÁCH HÀNG",
      description:
        "Danh sách khách hàng chi tiết, top doanh thu, phân loại và danh sách công nợ.",
      range,
      branchName,
      tenantName,
      generatedAt: new Date(),
    });

    const titleBase = {
      title: "BÁO CÁO PHÂN TÍCH KHÁCH HÀNG",
      range,
      branchName,
      tenantName,
      generatedAt: new Date(),
    };

    // Sheet 1: DS KH chi tiết — thông tin đầy đủ từng khách
    const customerDetailSheet: ExcelSheet = {
      name: "DS khách hàng",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "DANH SÁCH KHÁCH HÀNG CHI TIẾT",
      }),
      columns: [
        { label: "STT", key: "stt", width: 6, align: "center" },
        { label: "Mã KH", key: "code", width: 14 },
        { label: "Tên khách hàng", key: "name", width: 28 },
        { label: "SĐT", key: "phone", width: 14, align: "center" },
        { label: "Email", key: "email", width: 24 },
        { label: "Loại", key: "type", width: 12, align: "center" },
        { label: "Giới tính", key: "gender", width: 10, align: "center" },
        { label: "Nhóm KH", key: "groupName", width: 16 },
        { label: "Hạng thành viên", key: "loyaltyTier", width: 14 },
        { label: "Tổng mua (VND)", key: "totalSales", width: 18, format: "currency" },
        { label: "Công nợ (VND)", key: "debt", width: 16, format: "currency" },
      ],
      rows: customerList.map((c, i) => ({
        stt: i + 1,
        code: c.code,
        name: c.name,
        phone: c.phone,
        email: c.email ?? "",
        type: c.type === "individual" ? "Cá nhân" : "Doanh nghiệp",
        gender: c.gender === "male" ? "Nam" : c.gender === "female" ? "Nữ" : "",
        groupName: c.groupName ?? "",
        loyaltyTier: c.loyaltyTierName ?? "",
        totalSales: c.totalSalesMinusReturns ?? c.totalSales,
        debt: c.currentDebt,
      })),
      footer: {
        stt: "",
        code: "",
        name: `TỔNG (${customerList.length} khách)`,
        phone: "",
        email: "",
        type: "",
        gender: "",
        groupName: "",
        loyaltyTier: "",
        totalSales: customerList.reduce(
          (s, c) => s + (c.totalSalesMinusReturns ?? c.totalSales),
          0,
        ),
        debt: customerList.reduce((s, c) => s + c.currentDebt, 0),
      },
    };

    // Sheet 2: Top KH theo doanh thu (kỳ này)
    const topRevSheet: ExcelSheet = {
      name: "Top doanh thu",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "TẤT CẢ KHÁCH HÀNG THEO DOANH THU",
      }),
      columns: [
        { label: "Hạng", key: "rank", width: 8, align: "center" },
        { label: "Tên khách hàng", key: "name", width: 30 },
        { label: "Mã khách", key: "code", width: 18 },
        { label: "Nhóm khách", key: "groupName", width: 24 },
        { label: "Số đơn", key: "orders", width: 10, format: "number" },
        { label: "Doanh thu bán trước trả hàng (VND)", key: "revenue", width: 28, format: "currency" },
        { label: "TB/đơn (VND)", key: "avgTicket", width: 16, format: "currency" },
      ],
      rows: filteredRevenueCustomers.map((c) => ({
        rank: c.rank,
        name: c.name,
        code: c.code ?? "",
        groupName: c.groupName ?? "Chưa phân nhóm",
        orders: c.orders,
        revenue: c.revenue,
        avgTicket: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
      })),
      footer: {
        rank: "",
        name: "TỔNG CỘNG",
        orders: filteredRevenueCustomers.reduce((s, c) => s + c.orders, 0),
        revenue: filteredRevenueCustomers.reduce((s, c) => s + c.revenue, 0),
        avgTicket: "",
      },
    };

    // Sheet 3: Phân loại khách (segments)
    const segmentSheet: ExcelSheet = {
      name: "Phân loại",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "PHÂN LOẠI KHÁCH HÀNG THEO NHÓM",
      }),
      columns: [
        { label: "STT", key: "stt", width: 6, align: "center" },
        { label: "Nhóm khách", key: "name", width: 26 },
        { label: "Số khách", key: "value", width: 14, format: "number" },
        { label: "Tỷ trọng (%)", key: "share", width: 14, format: "percent" },
      ],
      rows: (() => {
        const total = customerSegments.reduce((s, x) => s + x.value, 0);
        return customerSegments.map((s, i) => ({
          stt: i + 1,
          name: s.name,
          value: s.value,
          share: total > 0 ? (s.value / total) * 100 : 0,
        }));
      })(),
      footer: {
        stt: "",
        name: "TỔNG CỘNG",
        value: customerSegments.reduce((s, x) => s + x.value, 0),
        share: 100,
      },
    };

    // Sheet 4: Top công nợ (KH còn nợ)
    const debtSheet: ExcelSheet = {
      name: "Top công nợ",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "DANH SÁCH KHÁCH HÀNG CÒN CÔNG NỢ",
      }),
      columns: [
        { label: "STT", key: "stt", width: 6, align: "center" },
        { label: "Tên khách hàng", key: "name", width: 30 },
        { label: "Công nợ (VND)", key: "debt", width: 20, format: "currency" },
      ],
      rows: filteredDebtors.map((d, i) => ({
        stt: i + 1,
        name: d.name,
        debt: d.debt,
      })),
      footer: {
        stt: "",
        name: "TỔNG CÔNG NỢ",
        debt: filteredDebtors.reduce((s, d) => s + d.debt, 0),
      },
    };

    // Sheet 5: Khách mới theo tháng (6 tháng)
    const newCustSheet: ExcelSheet = {
      name: "Khách mới theo tháng",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "SỐ KHÁCH HÀNG MỚI THEO THÁNG (6 THÁNG GẦN NHẤT)",
      }),
      columns: [
        { label: "Tháng", key: "label", width: 14 },
        { label: "Số khách mới", key: "value", width: 14, format: "number" },
      ],
      rows: newCustomersMonthly.map((p) => ({
        label: p.label,
        value: p.value,
      })),
      footer: {
        label: "TỔNG",
        value: newCustomersMonthly.reduce((s, p) => s + p.value, 0),
      },
    };

    await exportReportToExcel({
      kind: "khach-hang",
      mode: "full",
      range,
      branchName,
      tenantName,
      sheets: [
        infoSheet,
        customerDetailSheet,
        topRevSheet,
        segmentSheet,
        debtSheet,
        newCustSheet,
      ],
    });
    } catch (error) {
      toast({ title: "Không xuất được báo cáo khách hàng", description: error instanceof Error ? error.message : "Vui lòng thử lại.", variant: "error" });
    } finally { setExporting(false); }
  }, [
    kpis,
    newCustomersMonthly,
    customerSegments,
    activeBranchId,
    range,
    branchName,
    tenantName,
    customerSearch,
    customerSort,
    customerDirection,
    customerGroup,
    debtSearch,
    debtSort,
    debtDirection,
    exporting,
    toast,
  ]);

  const reportHeader = (
    <ReportPageHeader
      title="Báo cáo khách hàng"
      subtitle="Thống kê và phân loại khách hàng"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || exporting || !kpis}
    />
  );

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

  // KPI derived values
  if (loadError) return <div className="flex flex-col h-[calc(100vh-4rem)]">{reportHeader}<div role="alert" className="p-6 text-sm text-destructive">{loadError}<button type="button" onClick={fetchData} className="ml-3 underline">Thử lại</button></div></div>;
  const newMonthChange =
    kpis && kpis.prevNewMonth > 0
      ? Math.round(((kpis.newThisMonth - kpis.prevNewMonth) / kpis.prevNewMonth) * 100)
      : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng khách hàng"
            value={kpis ? String(kpis.totalCustomers) : "0"}
            change={kpis ? `+${kpis.newThisMonth} khách mới trong kỳ` : ""}
            positive
            icon="group"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Khách mới trong kỳ"
            value={kpis ? String(kpis.newThisMonth) : "0"}
            change={newMonthChange !== 0 ? `${newMonthChange > 0 ? "+" : ""}${newMonthChange}% so với kỳ trước` : "Không có dữ liệu kỳ trước"}
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
            change="Số dư công nợ hiện tại"
            positive
            icon="credit_card"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
        </div>

        {viewMode !== "table" && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* New customers per month */}
          <ChartCard title="Khách hàng mới theo tháng" subtitle="6 tháng gần nhất · Số liệu tham chiếu">
            {newCustomersMonthly.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
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
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
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

        }
        {/* Customer performance detail */}
        <ChartCard title="Doanh thu bán hàng theo khách hàng" subtitle="Hóa đơn hoàn thành trong kỳ · Trước trừ trả hàng">
          <div className="mb-3 flex flex-wrap gap-2">
            <input aria-label="Tìm khách hàng trong báo cáo" placeholder="Tên hoặc mã khách hàng" className="h-10 min-w-48 flex-1 rounded border bg-background px-3 text-sm" value={customerSearch} onChange={event => { setCustomerSearch(event.target.value); setCustomerPage(0); }} />
            <select aria-label="Nhóm khách hàng trong báo cáo" className="h-10 rounded border bg-background px-3 text-sm" value={customerGroup} onChange={event => { setCustomerGroup(event.target.value); setCustomerPage(0); }}><option value="">Tất cả nhóm khách</option>{customerGroups.map(group => <option key={group} value={group}>{group}</option>)}</select>
            <select aria-label="Sắp xếp khách hàng" className="h-10 rounded border bg-background px-3 text-sm" value={customerSort} onChange={event => { setCustomerSort(event.target.value as CustomerSort); setCustomerPage(0); }}><option value="revenue">Doanh thu bán</option><option value="orders">Số đơn</option><option value="average">Bình quân/đơn</option><option value="name">Tên khách hàng</option><option value="code">Mã khách</option><option value="groupName">Nhóm khách</option></select>
            <select aria-label="Chiều sắp xếp khách hàng" className="h-10 rounded border bg-background px-3 text-sm" value={customerDirection} onChange={event => { setCustomerDirection(event.target.value as SortDirection); setCustomerPage(0); }}><option value="desc">Giảm dần</option><option value="asc">Tăng dần</option></select>
          </div>
          {loadError ? <div role="alert" className="py-4 text-sm text-destructive">{loadError}<button type="button" className="ml-3 underline" onClick={fetchData}>Thử lại</button></div> : visibleCustomers.length > 0 ? (
            <ReportTableFrame tablePreferenceKey="report.customers.top">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">#</th>
                    <th className="text-left py-2 pr-4 font-medium">Khách hàng</th>
                    <th className="text-left py-2 pr-4 font-medium">Mã khách</th>
                    <th className="text-left py-2 pr-4 font-medium">Nhóm khách</th>
                    <th className="text-right py-2 pr-4 font-medium">Số đơn</th>
                    <th className="text-right py-2 font-medium">Doanh thu bán</th>
                    <th className="text-right py-2 font-medium">Bình quân/đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCustomers.map((item) => (
                    <tr key={item.customerId} className="border-b last:border-0">
                      <td className="py-3 pr-4 text-muted-foreground">{item.rank}</td>
                      <td className="py-3 pr-4 font-medium">{item.name}</td>
                      <td className="py-3 pr-4">{item.code ?? "—"}</td>
                      <td className="py-3 pr-4">{item.groupName ?? "Chưa phân nhóm"}</td>
                      <td className="py-3 pr-4 text-right">{item.orders}</td>
                      <td className="py-3 text-right font-medium text-primary">
                        {formatCurrency(item.revenue)}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums">{formatCurrency(item.orders ? item.revenue / item.orders : 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 bg-muted/40 font-semibold"><td colSpan={4} className="py-3">Tổng {visibleCustomers.length} khách</td><td className="text-right tabular-nums">{formatNumber(visibleCustomers.reduce((sum, c) => sum + c.orders, 0))}</td><td className="text-right tabular-nums">{formatCurrency(visibleCustomers.reduce((sum, c) => sum + c.revenue, 0))}</td><td /></tr></tfoot>
              </table>
              </div>
            </ReportTableFrame>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Không có khách hàng phù hợp trong kỳ
            </div>
          )}
          {pageCount > 1 && <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={currentPage === 0} className="disabled:opacity-40" onClick={() => setCustomerPage(currentPage - 1)}>Trước</button><span>{currentPage + 1}/{pageCount}</span><button type="button" disabled={currentPage + 1 === pageCount} className="disabled:opacity-40" onClick={() => setCustomerPage(currentPage + 1)}>Sau</button></div>}
        </ChartCard>

        <ChartCard title="Chi tiết công nợ khách hàng" subtitle="Số dư tại thời điểm hiện tại · Không phải phát sinh trong kỳ">
          <div className="mb-3 flex flex-wrap gap-2"><input aria-label="Tìm khách công nợ" placeholder="Tên khách hàng" className="h-10 min-w-48 flex-1 rounded border bg-background px-3 text-sm" value={debtSearch} onChange={event => setDebtSearch(event.target.value)} /><select aria-label="Sắp xếp công nợ khách" className="h-10 rounded border bg-background px-3 text-sm" value={debtSort} onChange={event => setDebtSort(event.target.value as typeof debtSort)}><option value="debt">Công nợ</option><option value="name">Tên khách hàng</option></select><select aria-label="Chiều sắp xếp công nợ khách" className="h-10 rounded border bg-background px-3 text-sm" value={debtDirection} onChange={event => setDebtDirection(event.target.value as SortDirection)}><option value="desc">Giảm dần</option><option value="asc">Tăng dần</option></select></div>
          <ReportTableFrame tablePreferenceKey="report.customers.debt-detail">
            <div className="max-h-96 overflow-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="border-b text-left"><th className="py-2">Khách hàng</th><th className="py-2 text-right">Công nợ</th></tr></thead><tbody>{visibleDebtors.map((row, index) => <tr key={`${row.name}-${index}`} className="border-b"><td className="py-2">{row.name}</td><td className="py-2 text-right tabular-nums">{formatCurrency(row.debt)}</td></tr>)}</tbody><tfoot><tr className="border-t-2 font-semibold"><td className="py-3">Tổng {visibleDebtors.length} khách</td><td className="py-3 text-right tabular-nums">{formatCurrency(visibleDebtors.reduce((sum, row) => sum + row.debt, 0))}</td></tr></tfoot></table></div>
          </ReportTableFrame>
        </ChartCard>

        {/* Customer debt ranking */}
        {viewMode !== "table" && <ChartCard title="Xếp hạng công nợ khách hàng" subtitle="Top 5 khách hàng có công nợ cao nhất">
          {topDebtors.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={topDebtors.slice(0, 5).reverse()}
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
        </ChartCard>}
      </div>
    </div>
  );
}
