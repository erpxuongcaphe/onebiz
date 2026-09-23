"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { getAllCashBookEntries, getCashBookListWorkspace } from "@/lib/services/supabase/cash-book";
import type { CashBookEntry } from "@/lib/types";
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
  const [ledgerRows, setLedgerRows] = useState<CashBookEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerType, setLedgerType] = useState<"all" | "receipt" | "payment">("all");
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestIdRef = useRef(0);
  const ledgerRequestIdRef = useRef(0);

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

  const handleExportView = useCallback(() => {
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
      exportReportToExcel({
        kind: "luong-tien",
        mode: "view",
        range,
        branchName: branchLabel,
        tenantName,
        sheets: cfSheet ? [infoSheet, cfSheet] : [infoSheet],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [buildSheets, range, branchLabel, tenantName, toast]);

  const handleExportFull = useCallback(async () => {
    setExporting(true);
    try {
      const sheets = buildSheets();
      if (canViewCashBook) {
        const entries = await getAllCashBookEntries({
          branchId: activeBranchId,
          dateFrom: range.from,
          dateToExclusive,
          statuses: ["completed"],
          types: ledgerType === "all" ? undefined : [ledgerType],
        });
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
            { label: "Đối tượng", key: "counterparty", width: 28 },
            { label: "Danh mục", key: "category", width: 24 },
            { label: "Phương thức", key: "paymentMethod", width: 18 },
            { label: "Chứng từ gốc", key: "reference", width: 20 },
            { label: "Số tiền", key: "amount", width: 20, format: "currency" },
          ],
          rows: entries.map((entry) => ({
            date: entry.date,
            code: entry.code,
            type: entry.type === "receipt" ? "Thu" : "Chi",
            branch: entry.branchName ?? "",
            counterparty: entry.counterparty,
            category: cashCategoryLabel(entry.category),
            paymentMethod: cashPaymentMethodLabel(entry.paymentMethod),
            reference: entry.referenceCode ?? "",
            amount: entry.amount,
          })),
        });
      }
      exportReportToExcel({
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
  }, [buildSheets, canViewCashBook, activeBranchId, range, dateToExclusive, ledgerType, branchLabel, tenantName, toast]);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getCashFlowDetailed(6, activeBranchId, range);
      if (requestId === requestIdRef.current) setData(result);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setData([]);
        setLoadError(error instanceof Error ? error.message : "Không tải được báo cáo thu chi.");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, isReady, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isReady || !canViewCashBook) return;
    const requestId = ++ledgerRequestIdRef.current;
    setLedgerLoading(true);
    setLedgerError(null);
    setLedgerRows([]);
    setLedgerTotal(0);
    getCashBookListWorkspace({
      page: ledgerPage,
      pageSize: 50,
      branchId: activeBranchId,
      dateFrom: range.from,
      dateToExclusive,
      statuses: ["completed"],
      types: ledgerType === "all" ? undefined : [ledgerType],
    }).then((result) => {
      if (requestId !== ledgerRequestIdRef.current) return;
      if (result.data.length === 0 && result.total > 0 && ledgerPage > 0) {
        setLedgerPage(0);
        return;
      }
      setLedgerRows(result.data);
      setLedgerTotal(result.total);
    }).catch((error) => {
      if (requestId !== ledgerRequestIdRef.current) return;
      setLedgerRows([]);
      setLedgerTotal(0);
      setLedgerError(error instanceof Error ? error.message : "Không tải được chứng từ thu chi.");
    }).finally(() => {
      if (requestId === ledgerRequestIdRef.current) setLedgerLoading(false);
    });
  }, [isReady, canViewCashBook, ledgerPage, ledgerType, activeBranchId, range.from, dateToExclusive]);

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
      <div className="space-y-6 p-4 sm:p-6">
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
          <ReportTableFrame tablePreferenceKey="report.cash-flow.transactions">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Ngày chứng từ</th>
                    <th className="px-3 py-2">Mã phiếu</th>
                    <th className="px-3 py-2">Loại</th>
                    <th className="px-3 py-2">Chi nhánh</th>
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
              <span>Trang {ledgerPage + 1}/{Math.ceil(ledgerTotal / 50)}</span>
              <Button variant="outline" size="sm" disabled={ledgerPage === 0 || ledgerLoading} onClick={() => setLedgerPage((page) => page - 1)}>Trước</Button>
              <Button variant="outline" size="sm" disabled={(ledgerPage + 1) * 50 >= ledgerTotal || ledgerLoading} onClick={() => setLedgerPage((page) => page + 1)}>Sau</Button>
            </div>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
