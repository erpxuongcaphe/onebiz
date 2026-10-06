"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { formatCurrency, formatDate, formatChartCurrency, formatChartTooltipCurrency } from "@/lib/format";
import { getCashFlowDetailed } from "@/lib/services/supabase/analytics";
import type { CashFlowDetailedRow } from "@/lib/services/supabase/analytics";
import { getAllCashBookEntries } from "@/lib/services/supabase/cash-book";
import { cashReportRows, type CashTableFilter } from "@/lib/reports/management-table-view";
import type { CashBookEntry } from "@/lib/types";
import {getFinanceCashLinks} from '@/lib/services/supabase/management-finance';
import {CASH_FLOW_LABELS,cashFlowMonths,reconcileCashFlow} from '@/lib/utils/finance-report-reconciliation';
import {CashFlowReconciliationTable,type CashFlowReconciliation} from '@/components/shared/report/cash-flow-reconciliation';
import { PERMISSIONS } from "@/lib/permissions/constants";
import { Button } from "@/components/ui/button";
import { cashCategoryLabel, cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";
import { Icon } from "@/components/ui/icon";
import { formatSelectedPeriodLabel } from "@/lib/utils/date-presets";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";

// ── Custom Tooltip ──
interface CashFlowTooltipEntry {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number;
}

interface CashFlowTooltipProps {
  active?: boolean;
  payload?: CashFlowTooltipEntry[];
  label?: string;
}

function CashFlowTooltip({ active, payload, label }: CashFlowTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-xs space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatChartTooltipCurrency(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LuongTienPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { tenant, hasPermission } = useAuth();
  const canViewCashBook = hasPermission(PERMISSIONS.FINANCE_VIEW_CASH_BOOK);
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisYear", defaultViewMode: "table" });
  const selectedPeriodLabel = formatSelectedPeriodLabel(preset, range);
  const [data, setData] = useState<CashFlowDetailedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allLedgerRows, setAllLedgerRows] = useState<CashBookEntry[]>([]);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerType, setLedgerType] = useState<"all" | "receipt" | "payment">("all");
  const [ledgerFilter, setLedgerFilter] = useState<Omit<CashTableFilter, "type">>({ search: "", category: "", method: "", min: "", max: "", sort: "date", direction: "desc" });
  const filteredLedgerRows = useMemo(() => cashReportRows(allLedgerRows, { ...ledgerFilter, type: ledgerType }), [allLedgerRows, ledgerFilter, ledgerType]);
  const ledgerTotal = filteredLedgerRows.length;
  const currentLedgerPage = Math.min(ledgerPage, Math.max(0, Math.ceil(ledgerTotal / 50) - 1));
  const ledgerRows = filteredLedgerRows.slice(currentLedgerPage * 50, (currentLedgerPage + 1) * 50);
  const ledgerLoading = loading;
  const ledgerError = loadError;
  const ledgerCategories = [...new Set([...allLedgerRows.map(row => row.category), ...(ledgerFilter.category ? [ledgerFilter.category] : [])])].sort((a, b) => cashCategoryLabel(a).localeCompare(cashCategoryLabel(b), "vi"));
  const ledgerMethods = [...new Set([...allLedgerRows.map(row => row.paymentMethod).filter((value): value is string => Boolean(value)), ...(ledgerFilter.method ? [ledgerFilter.method] : [])])];
  const updateLedgerFilter = (patch: Partial<typeof ledgerFilter>) => { setLedgerFilter(value => ({ ...value, ...patch })); setLedgerPage(0); };
  const [exporting, setExporting] = useState(false);
  const [reconciliation,setReconciliation] = useState<CashFlowReconciliation | null>(null);
  const requestIdRef = useRef(0);

  const tenantName = tenant?.name;
  const dateToExclusive = new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const buildSheets = useCallback((): ExcelSheet[] => {
    // Sheet 0: Info + disclaimer
    const infoSheet = buildInfoSheet({
      title: "BÁO CÁO THU CHI VÀ DÒNG TIỀN",
      description:
        "Phiếu thu, phiếu chi hoàn thành theo ngày chứng từ; dòng tiền lũy kế chỉ tính trong kỳ đã chọn.",
      range,
      branchName: branchLabel,
      tenantName,
      generatedAt: new Date(),
      disclaimer:
        "Báo cáo quản trị nội bộ — không thay thế Báo cáo lưu chuyển tiền tệ (B03-DN) theo Thông tư 200/133.",
    });

    const titleBase = {
      title: "BÁO CÁO THU CHI VÀ DÒNG TIỀN",
      range,
      branchName: branchLabel,
      tenantName,
      generatedAt: new Date(),
    };

    // Sheet 1: tổng hợp thu chi theo tháng trong kỳ đã chọn.
    const cashFlowSheet: ExcelSheet = {
      name: "Thu chi theo tháng",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "THU CHI THEO THÁNG TRONG KỲ",
      }),
      columns: [
        { label: "Tháng", key: "month", width: 16, align: "center" },
        { label: "Thu vào (VND)", key: "receipt", width: 20, format: "currency" },
        { label: "Chi ra (VND)", key: "payment", width: 20, format: "currency" },
        {
          label: "Dòng tiền ròng",
          key: "net",
          width: 20,
          format: "currency",
        },
        {
          label: "Dòng tiền lũy kế trong kỳ",
          key: "balance",
          width: 22,
          format: "currency",
        },
      ],
      rows: data.map((d) => ({
        month: d.month,
        receipt: d.totalReceipt,
        payment: d.totalPayment,
        net: d.net,
        balance: d.cumulativeBalance,
      })),
      footer: {
        month: "TỔNG KỲ",
        receipt: data.reduce((s, d) => s + d.totalReceipt, 0),
        payment: data.reduce((s, d) => s + d.totalPayment, 0),
        net: data.reduce((s, d) => s + d.net, 0),
        balance: "",
      },
      withSignature: true,
    };

    const categoryDetail: ExcelSheet = {
      name: "Chi tiết danh mục",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "CHI TIẾT THU CHI THEO DANH MỤC",
      }),
      columns: [
        { label: "Tháng", key: "month", width: 16 },
        { label: "Loại", key: "type", width: 12 },
        { label: "Danh mục", key: "category", width: 32 },
        { label: "Số tiền (VND)", key: "amount", width: 22, format: "currency" },
      ],
      rows: data.flatMap((row) => [
        ...row.receipts.map((item) => ({
          month: row.month,
          type: "Thu",
          category: cashCategoryLabel(item.category),
          amount: item.amount,
        })),
        ...row.payments.map((item) => ({
          month: row.month,
          type: "Chi",
          category: cashCategoryLabel(item.category),
          amount: item.amount,
        })),
      ]),
    };

    return [infoSheet, cashFlowSheet, categoryDetail];
  }, [data, range, branchLabel, tenantName]);

  const handleExportView = useCallback(async () => {
    if (exporting || loading || loadError) return;
    setExporting(true);
    try {
      // View export chỉ gồm phần tổng hợp theo tháng và thông tin phạm vi.
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO THU CHI VÀ DÒNG TIỀN",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
        disclaimer: "Báo cáo quản trị nội bộ; dòng tiền lũy kế không phải số dư quỹ đầu kỳ hay B03-DN.",
      });
      const allSheets = buildSheets();
      const cfSheet = allSheets.find((s) => s.name === "Thu chi theo tháng");
      const detailSheet: ExcelSheet = {
        name: "Chứng từ đã lọc",
        columns: [
          { label: "Ngày chứng từ", key: "date", width: 18 },
          { label: "Mã phiếu", key: "code", width: 18 },
          { label: "Loại", key: "type", width: 12 },
          { label: "Chi nhánh", key: "branchName", width: 28 },
          { label: "Người tạo", key: "createdByName", width: 24 },
          { label: "Người thu/chi", key: "performedByName", width: 24 },
          { label: "Thực thu/chi lúc", key: "occurredAt", width: 24 },
          { label: "Đối tượng", key: "counterparty", width: 28 },
          { label: "Danh mục", key: "category", width: 28 },
          { label: "Phương thức", key: "paymentMethod", width: 20 },
          { label: "Chứng từ gốc", key: "referenceCode", width: 20 },
          { label: "Số tiền", key: "amount", width: 20, format: "currency" },
        ],
        rows: filteredLedgerRows.map(row => ({ ...row, type: row.type === "receipt" ? "Thu" : "Chi", category: cashCategoryLabel(row.category), paymentMethod: cashPaymentMethodLabel(row.paymentMethod) })),
      };
      await exportReportToExcel({
        kind: "luong-tien",
        mode: "view",
        range,
        branchName: branchLabel,
        tenantName,
        sheets: [...(cfSheet ? [infoSheet, cfSheet] : [infoSheet]), ...(canViewCashBook ? [detailSheet] : [])],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally { setExporting(false); }
  }, [buildSheets, range, branchLabel, tenantName, toast, filteredLedgerRows, canViewCashBook, exporting, loading, loadError]);

  const handleExportFull = useCallback(async () => {
    if (exporting || loading || loadError) return;
    setExporting(true);
    try {
      const sheets = buildSheets();
      if (canViewCashBook) {
        const entries = await getAllCashBookEntries({
          branchId: activeBranchId,
          dateFrom: range.from,
          dateToExclusive,
          statuses: ["completed"],
        });
        const sources = await getFinanceCashLinks(range.from,range.to,activeBranchId);
        const checked = reconcileCashFlow(entries,sources);
        if (Math.abs(checked.receipt-data.reduce((s,r) => s+r.totalReceipt,0))>0.005 || Math.abs(checked.payment-data.reduce((s,r) => s+r.totalPayment,0))>0.005) {
          throw new Error('Số liệu đã thay đổi, tải lại báo cáo trước khi xuất');
        }
        sheets.push({name:'Hoạt động dòng tiền',columns:[{label:'Hoạt động',key:'activity',width:28},{label:'Số phiếu',key:'count',width:14},{label:'Thu',key:'receipt',format:'currency',width:22},{label:'Chi',key:'payment',format:'currency',width:22},{label:'Ròng',key:'net',format:'currency',width:22}],rows:checked.totals.map(r => ({...r,activity:CASH_FLOW_LABELS[r.activity]}))});
        sheets.push({name:'Nguồn dòng tiền',columns:[{label:'Phiếu',key:'code',width:18},{label:'Ngày hạch toán',key:'date',width:18},{label:'Hoạt động',key:'activity',width:28},{label:'Khoản mục',key:'category',width:30},{label:'Mã khoản mục',key:'categoryCode',width:22},{label:'Khoản ghi nhận',key:'eventCode',width:22},{label:'Chi nhánh',key:'branchName',width:30},{label:'Người thực hiện',key:'performedByName',width:26},{label:'Đối tượng',key:'counterparty',width:30},{label:'Thu',key:'receipt',format:'currency',width:22},{label:'Chi',key:'payment',format:'currency',width:22}],rows:checked.detail.map(r => ({...r,activity:CASH_FLOW_LABELS[r.activity],receipt:r.type === 'receipt' ? r.amount : 0,payment:r.type === 'payment' ? r.amount : 0}))});
        sheets.push({
          name: "Chứng từ thu chi",
          titleRows: buildReportTitleRows({
            title: ledgerType === "receipt" ? "PHIẾU THU TRONG KỲ" : ledgerType === "payment" ? "PHIẾU CHI TRONG KỲ" : "CHỨNG TỪ THU CHI TRONG KỲ",
            range,
            branchName: branchLabel,
            tenantName,
            generatedAt: new Date(),
          }),
          columns: [
            { label: "Ngày chứng từ", key: "date", width: 18 },
            { label: "Mã phiếu", key: "code", width: 18 },
            { label: "Loại", key: "type", width: 14 },
            { label: "Chi nhánh", key: "branch", width: 26 },
            { label: "Người tạo phiếu", key: "createdBy", width: 24 },
            { label: "Người thực hiện thu/chi", key: "performedBy", width: 26 },
            { label: "Thực thu/chi lúc", key: "occurredAt", width: 24 },
            { label: "Đối tượng", key: "counterparty", width: 28 },
            { label: "Danh mục", key: "category", width: 24 },
            { label: "Phương thức", key: "paymentMethod", width: 18 },
            { label: "Chứng từ gốc", key: "reference", width: 20 },
            { label: "Số tiền", key: "amount", width: 20, format: "currency" },
          ],
          rows: cashReportRows(entries, { ...ledgerFilter, type: ledgerType }).map((entry) => ({
            date: entry.date,
            code: entry.code,
            type: entry.type === "receipt" ? "Thu" : "Chi",
            branch: entry.branchName ?? "",
            createdBy: entry.createdByName ?? "",
            performedBy: entry.performedByName ?? "Chưa ghi nhận",
            occurredAt: entry.occurredAt ?? "",
            counterparty: entry.counterparty,
            category: cashCategoryLabel(entry.category),
            paymentMethod: cashPaymentMethodLabel(entry.paymentMethod),
            reference: entry.referenceCode ?? "",
            amount: entry.amount,
          })),
        });
      }
      await exportReportToExcel({
        kind: "luong-tien",
        mode: "full",
        range,
        branchName: branchLabel,
        tenantName,
        sheets,
      });
      toast({
        title: "Đã xuất báo cáo thu chi",
        description: canViewCashBook ? "Có danh sách chứng từ thu chi trong kỳ." : "Báo cáo tổng hợp theo tháng và danh mục.",
        variant: "success",
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
  }, [buildSheets, canViewCashBook, activeBranchId, range, dateToExclusive, ledgerType, ledgerFilter, branchLabel, tenantName, toast, data, exporting, loading, loadError]);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    setReconciliation(null);
    setAllLedgerRows([]);
    try {
      if (canViewCashBook) {
        const [entries,sources] = await Promise.all([
          getAllCashBookEntries({branchId:activeBranchId,dateFrom:range.from,dateToExclusive,statuses:['completed']}),
          getFinanceCashLinks(range.from,range.to,activeBranchId),
        ]);
        const checked = reconcileCashFlow(entries,sources);
        const months = cashFlowMonths(entries,range.from,range.to);
        if (requestId === requestIdRef.current) {setData(months);setReconciliation(checked);setAllLedgerRows(entries);}
      } else {
        const result = await getCashFlowDetailed(6, activeBranchId, range);
        if (requestId === requestIdRef.current) setData(result);
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setData([]);
        setLoadError(error instanceof Error ? error.message : "Không tải được báo cáo thu chi.");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, isReady, range,canViewCashBook,dateToExclusive]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalReceipt = data.reduce((sum, row) => sum + row.totalReceipt, 0);
  const totalPayment = data.reduce((sum, row) => sum + row.totalPayment, 0);
  const net = totalReceipt - totalPayment;

  // Chart data for stacked bar
  const chartData = data.map((d) => ({
    month: d.month,
    "Thu vào": d.totalReceipt,
    "Chi ra": d.totalPayment,
  }));

  // Cumulative balance line chart
  const balanceData = data.map((d) => ({
    month: d.month,
    "Dòng tiền lũy kế": d.cumulativeBalance,
    "Dòng tiền ròng": d.net,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-y-auto">
      <ReportPageHeader
        title="Báo cáo thu chi và dòng tiền"
        subtitle="Theo ngày chứng từ; dòng tiền lũy kế chỉ tính trong kỳ đã chọn"
        preset={preset}
        range={range}
        onPresetChange={(next) => { setPreset(next); setLedgerPage(0); }}
        onCustomRangeChange={(next) => { setCustomRange(next); setLedgerPage(0); }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || exporting || data.length === 0 || Boolean(loadError)}
      />
      <div className="space-y-4 p-4 sm:p-6">
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span>Không tải được báo cáo: {loadError}</span>
          <Button variant="outline" size="sm" onClick={fetchData}>Tải lại</Button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Tổng thu trong kỳ"
          value={formatCurrency(totalReceipt)}
          icon="north_east"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Tổng chi trong kỳ"
          value={formatCurrency(totalPayment)}
          icon="south_east"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Dòng tiền ròng trong kỳ"
          value={formatCurrency(net)}
          icon={net >= 0 ? "trending_up" : "trending_down"}
          bg={net >= 0 ? "bg-primary-fixed" : "bg-status-warning/10"}
          iconColor={net >= 0 ? "text-primary" : "text-status-warning"}
          valueColor="text-foreground"
          positive={net >= 0}
        />
      </div>

      {reconciliation && <CashFlowReconciliationTable key={`${activeBranchId}:${range.from}:${range.to}`} report={reconciliation}/>}

      {viewMode === "chart" && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Thu - Chi theo tháng" subtitle={selectedPeriodLabel}>
          <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<CashFlowTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Thu vào" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Chi ra" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Dòng tiền ròng và lũy kế trong kỳ" subtitle={selectedPeriodLabel}>
          <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height={280} minWidth={0}>
            <LineChart data={balanceData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<CashFlowTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="linear" dataKey="Dòng tiền ròng" stroke="#004AC6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="linear" dataKey="Dòng tiền lũy kế" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      )}

      {viewMode === "table" && (
      <ChartCard title="Chi tiết theo tháng" subtitle={selectedPeriodLabel}>
        <ReportTableFrame tablePreferenceKey="report.cash-flow.months">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 px-3 font-medium">Tháng</th>
                <th className="py-2 px-3 font-medium text-right">Tổng thu</th>
                <th className="py-2 px-3 font-medium text-right">Tổng chi</th>
                <th className="py-2 px-3 font-medium text-right">Ròng</th>
                <th className="py-2 px-3 font-medium text-right">Lũy kế trong kỳ</th>
                <th className="py-2 px-3 font-medium">Chi tiết thu</th>
                <th className="py-2 px-3 font-medium">Chi tiết chi</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.month} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3 font-medium">{row.month}</td>
                  <td className="py-2 px-3 text-right text-status-success font-medium">
                    {formatCurrency(row.totalReceipt)}
                  </td>
                  <td className="py-2 px-3 text-right text-status-error font-medium">
                    {formatCurrency(row.totalPayment)}
                  </td>
                  <td className={`py-2 px-3 text-right font-bold ${row.net >= 0 ? "text-status-success" : "text-status-error"}`}>
                    {row.net >= 0 ? "+" : ""}{formatCurrency(row.net)}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${row.cumulativeBalance >= 0 ? "text-primary" : "text-status-error"}`}>
                    {formatCurrency(row.cumulativeBalance)}
                  </td>
                  <td className="py-2 px-3">
                    <div className="space-y-0.5">
                      {row.receipts.map((r) => (
                        <div key={r.category} className="text-xs text-muted-foreground">
                          {cashCategoryLabel(r.category)}: <span className="font-medium text-foreground">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                      {row.receipts.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="space-y-0.5">
                      {row.payments.map((p) => (
                        <div key={p.category} className="text-xs text-muted-foreground">
                          {cashCategoryLabel(p.category)}: <span className="font-medium text-foreground">{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                      {row.payments.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </ReportTableFrame>
      </ChartCard>
      )}
      {canViewCashBook && (
        <section className="space-y-3" aria-label="Chứng từ thu chi">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Chứng từ thu chi</h2>
              <p className="text-xs text-muted-foreground">Phiếu hoàn thành theo ngày chứng từ · {ledgerTotal.toLocaleString("vi-VN")} phiếu</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span>Loại phiếu</span>
              <select
                className="h-9 rounded border bg-background px-2"
                value={ledgerType}
                onChange={(event) => {
                  setLedgerType(event.target.value as "all" | "receipt" | "payment");
                  setLedgerPage(0);
                }}
              >
                <option value="all">Tất cả</option>
                <option value="receipt">Phiếu thu</option>
                <option value="payment">Phiếu chi</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Tìm chứng từ thu chi" placeholder="Mã phiếu, đối tượng, người thu/chi, ghi chú" className="h-10 min-w-48 flex-1 rounded border bg-background px-3 text-sm" value={ledgerFilter.search} onChange={event => updateLedgerFilter({ search: event.target.value })} />
            <select aria-label="Danh mục thu chi" className="h-10 max-w-full rounded border bg-background px-3 text-sm" value={ledgerFilter.category} onChange={event => updateLedgerFilter({ category: event.target.value })}><option value="">Tất cả danh mục</option>{ledgerCategories.map(value => <option key={value} value={value}>{cashCategoryLabel(value)}</option>)}</select>
            <select aria-label="Phương thức thu chi" className="h-10 rounded border bg-background px-3 text-sm" value={ledgerFilter.method} onChange={event => updateLedgerFilter({ method: event.target.value })}><option value="">Tất cả phương thức</option>{ledgerMethods.map(value => <option key={value} value={value}>{cashPaymentMethodLabel(value)}</option>)}</select>
            <input aria-label="Số tiền tối thiểu" placeholder="Tiền từ" type="number" min="0" className="h-10 w-36 rounded border bg-background px-3 text-sm" value={ledgerFilter.min} onChange={event => updateLedgerFilter({ min: event.target.value })} />
            <input aria-label="Số tiền tối đa" placeholder="Tiền đến" type="number" min="0" className="h-10 w-36 rounded border bg-background px-3 text-sm" value={ledgerFilter.max} onChange={event => updateLedgerFilter({ max: event.target.value })} />
            <select aria-label="Sắp xếp chứng từ thu chi" className="h-10 rounded border bg-background px-3 text-sm" value={ledgerFilter.sort} onChange={event => updateLedgerFilter({ sort: event.target.value as CashTableFilter["sort"] })}>{Object.entries({ date: "Ngày chứng từ", occurredAt: "Thực thu/chi lúc", code: "Mã phiếu", type: "Loại thu/chi", amount: "Số tiền", counterparty: "Đối tượng", branchName: "Chi nhánh", category: "Danh mục", paymentMethod: "Phương thức", createdByName: "Người tạo", performedByName: "Người thu/chi", referenceCode: "Chứng từ gốc" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select aria-label="Chiều sắp xếp thu chi" className="h-10 rounded border bg-background px-3 text-sm" value={ledgerFilter.direction} onChange={event => updateLedgerFilter({ direction: event.target.value as "asc" | "desc" })}><option value="desc">Giảm dần</option><option value="asc">Tăng dần</option></select>
          </div>
          {ledgerFilter.min !== "" && ledgerFilter.max !== "" && Number(ledgerFilter.min) > Number(ledgerFilter.max) && <p role="alert" className="text-sm text-destructive">Số tiền từ phải nhỏ hơn hoặc bằng số tiền đến.</p>}
          <p className="text-sm tabular-nums">Kết quả lọc: {ledgerTotal.toLocaleString("vi-VN")} phiếu · Thu: {formatCurrency(filteredLedgerRows.filter(row => row.type === "receipt").reduce((sum, row) => sum + row.amount, 0))} · Chi: {formatCurrency(filteredLedgerRows.filter(row => row.type === "payment").reduce((sum, row) => sum + row.amount, 0))}</p>
          <ReportTableFrame tablePreferenceKey="report.cash-flow.transactions">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Ngày chứng từ</th>
                    <th className="px-3 py-2">Mã phiếu</th>
                    <th className="px-3 py-2">Loại</th>
                    <th className="px-3 py-2">Chi nhánh</th>
                    <th className="px-3 py-2">Người tạo phiếu</th>
                    <th className="px-3 py-2">Người thực hiện thu/chi</th>
                    <th className="px-3 py-2">Thực thu/chi lúc</th>
                    <th className="px-3 py-2">Đối tượng</th>
                    <th className="px-3 py-2">Danh mục</th>
                    <th className="px-3 py-2">Phương thức</th>
                    <th className="px-3 py-2">Chứng từ gốc</th>
                    <th className="px-3 py-2 text-right">Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((entry) => (
                    <tr key={entry.id} className="border-b">
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(entry.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{entry.code}</td>
                      <td className="px-3 py-2">{entry.type === "receipt" ? "Thu" : "Chi"}</td>
                      <td className="px-3 py-2">{entry.branchName ?? "—"}</td>
                      <td className="px-3 py-2">{entry.createdByName || "—"}</td>
                      <td className="px-3 py-2">{entry.performedByName || "Chưa ghi nhận"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{entry.occurredAt ? new Date(entry.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa ghi nhận"}</td>
                      <td className="px-3 py-2">{entry.counterparty || "—"}</td>
                      <td className="px-3 py-2">{cashCategoryLabel(entry.category)}</td>
                      <td className="px-3 py-2">{cashPaymentMethodLabel(entry.paymentMethod)}</td>
                      <td className="px-3 py-2">{entry.referenceCode ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatCurrency(entry.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ledgerLoading && !ledgerError && ledgerRows.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">Không có phiếu thu chi trong phạm vi đã chọn.</p>
              )}
              {ledgerLoading && <p className="p-4 text-sm text-muted-foreground">Đang tải chứng từ...</p>}
              {ledgerError && <p role="alert" className="p-4 text-sm text-destructive">Không tải được chứng từ: {ledgerError}</p>}
            </div>
          </ReportTableFrame>
          {ledgerTotal > 50 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span>Trang {currentLedgerPage + 1}/{Math.ceil(ledgerTotal / 50)}</span>
              <Button variant="outline" size="sm" disabled={currentLedgerPage === 0 || ledgerLoading} onClick={() => setLedgerPage(currentLedgerPage - 1)}>Trước</Button>
              <Button variant="outline" size="sm" disabled={(currentLedgerPage + 1) * 50 >= ledgerTotal || ledgerLoading} onClick={() => setLedgerPage(currentLedgerPage + 1)}>Sau</Button>
            </div>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
