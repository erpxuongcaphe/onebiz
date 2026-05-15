"use client";

import { useState, useEffect, useCallback } from "react";
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
import { formatCurrency, formatChartCurrency, formatChartTooltipCurrency } from "@/lib/format";
import { getCashFlowDetailed } from "@/lib/services/supabase/analytics";
import type { CashFlowDetailedRow } from "@/lib/services/supabase/analytics";
import { Icon } from "@/components/ui/icon";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";

// ── Custom Tooltip ──
function CashFlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-xs space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatChartTooltipCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LuongTienPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisYear", defaultViewMode: "chart" });
  const [data, setData] = useState<CashFlowDetailedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantName = useAuth().tenant?.name;
  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const buildSheets = useCallback((): ExcelSheet[] => {
    // Sheet 0: Info + disclaimer
    const infoSheet = buildInfoSheet({
      title: "BÁO CÁO LƯU CHUYỂN TIỀN TỆ",
      description:
        "Dòng tiền thu/chi 6 tháng gần nhất, dòng tiền ròng và số dư luỹ kế.",
      range,
      branchName: branchLabel,
      tenantName,
      generatedAt: new Date(),
      disclaimer:
        "Báo cáo quản trị nội bộ — không thay thế Báo cáo lưu chuyển tiền tệ (B03-DN) theo Thông tư 200/133.",
    });

    const titleBase = {
      title: "BÁO CÁO LƯU CHUYỂN TIỀN TỆ",
      range,
      branchName: branchLabel,
      tenantName,
      generatedAt: new Date(),
    };

    // Sheet 1: Cash flow 6 tháng (theo MISA trực tiếp)
    const cashFlowSheet: ExcelSheet = {
      name: "Cash flow",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: "LƯU CHUYỂN TIỀN 6 THÁNG GẦN NHẤT",
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
          label: "Số dư luỹ kế",
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
        month: "TỔNG 6 THÁNG",
        receipt: data.reduce((s, d) => s + d.totalReceipt, 0),
        payment: data.reduce((s, d) => s + d.totalPayment, 0),
        net: data.reduce((s, d) => s + d.net, 0),
        balance: "",
      },
      withSignature: true,
    };

    // Sheet 2: Thu chi tháng cuối kỳ (drill chi tiết)
    const lastMonth = data[data.length - 1];
    const monthDetail: ExcelSheet = {
      name: "Thu chi tháng này",
      titleRows: buildReportTitleRows({
        ...titleBase,
        title: `THU CHI THÁNG ${lastMonth?.month ?? "—"}`,
      }),
      columns: [
        { label: "Chỉ tiêu", key: "metric", width: 32 },
        { label: "Số tiền (VND)", key: "value", width: 22, format: "currency" },
      ],
      rows: [
        { metric: "Tổng thu", value: lastMonth?.totalReceipt ?? 0 },
        { metric: "Tổng chi", value: lastMonth?.totalPayment ?? 0 },
        { metric: "Dòng tiền ròng", value: lastMonth?.net ?? 0 },
        { metric: "Số dư đầu kỳ", value: 0 },
        { metric: "Số dư cuối kỳ (luỹ kế)", value: lastMonth?.cumulativeBalance ?? 0 },
      ],
    };

    return [infoSheet, cashFlowSheet, monthDetail];
  }, [data, range, branchLabel, tenantName]);

  const handleExportView = useCallback(() => {
    try {
      // View mode: chỉ Cash flow 6 tháng (1 sheet chính + info)
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO LƯU CHUYỂN TIỀN TỆ",
        range,
        branchName: branchLabel,
        tenantName,
        generatedAt: new Date(),
      });
      const allSheets = buildSheets();
      const cfSheet = allSheets.find((s) => s.name === "Cash flow");
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

  const handleExportFull = useCallback(() => {
    try {
      exportReportToExcel({
        kind: "luong-tien",
        mode: "full",
        range,
        branchName: branchLabel,
        tenantName,
        sheets: buildSheets(),
      });
      toast({
        title: "Đã xuất báo cáo lưu chuyển tiền",
        description: "3 sheet: Info + Cash flow 6 tháng + Thu chi tháng này",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [buildSheets, range, branchLabel, tenantName, toast]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCashFlowDetailed(6, activeBranchId);
      setData(result);
    } catch {
      // silent fail — data stays empty
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  // Aggregate current month KPIs
  const current = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;
  const totalReceipt = current?.totalReceipt ?? 0;
  const totalPayment = current?.totalPayment ?? 0;
  const net = current?.net ?? 0;
  const balance = current?.cumulativeBalance ?? 0;

  // Chart data for stacked bar
  const chartData = data.map((d) => ({
    month: d.month,
    "Thu vào": d.totalReceipt,
    "Chi ra": d.totalPayment,
  }));

  // Cumulative balance line chart
  const balanceData = data.map((d) => ({
    month: d.month,
    "Số dư luỹ kế": d.cumulativeBalance,
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
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      <ReportPageHeader
        title="Lưu chuyển tiền tệ"
        subtitle="Phân tích dòng tiền vào/ra 6 tháng gần nhất"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || data.length === 0}
      />
      <div className="space-y-6 p-4 sm:p-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Thu tháng này"
          value={formatCurrency(totalReceipt)}
          icon="north_east"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-foreground"
          change={prev ? `${((totalReceipt - prev.totalReceipt) / Math.max(prev.totalReceipt, 1) * 100).toFixed(1)}%` : undefined}
          positive={prev ? totalReceipt >= prev.totalReceipt : undefined}
        />
        <KpiCard
          label="Chi tháng này"
          value={formatCurrency(totalPayment)}
          icon="south_east"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-foreground"
          change={prev ? `${((totalPayment - prev.totalPayment) / Math.max(prev.totalPayment, 1) * 100).toFixed(1)}%` : undefined}
          positive={prev ? totalPayment <= prev.totalPayment : undefined}
        />
        <KpiCard
          label="Dòng tiền ròng"
          value={formatCurrency(net)}
          icon={net >= 0 ? "trending_up" : "trending_down"}
          bg={net >= 0 ? "bg-primary-fixed" : "bg-status-warning/10"}
          iconColor={net >= 0 ? "text-primary" : "text-status-warning"}
          valueColor="text-foreground"
          positive={net >= 0}
        />
        <KpiCard
          label="Số dư luỹ kế"
          value={formatCurrency(balance)}
          icon="account_balance_wallet"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
          positive={balance >= 0}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Thu - Chi theo tháng">
          <ResponsiveContainer width="100%" height={280}>
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

        <ChartCard title="Dòng tiền ròng & Số dư luỹ kế">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={balanceData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<CashFlowTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Dòng tiền ròng" stroke="#004AC6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Số dư luỹ kế" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Detail Table */}
      <ChartCard title="Chi tiết theo tháng">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 px-3 font-medium">Tháng</th>
                <th className="py-2 px-3 font-medium text-right">Tổng thu</th>
                <th className="py-2 px-3 font-medium text-right">Tổng chi</th>
                <th className="py-2 px-3 font-medium text-right">Ròng</th>
                <th className="py-2 px-3 font-medium text-right">Số dư luỹ kế</th>
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
                      {row.receipts.slice(0, 3).map((r) => (
                        <div key={r.category} className="text-xs text-muted-foreground">
                          {r.category}: <span className="font-medium text-foreground">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                      {row.receipts.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="space-y-0.5">
                      {row.payments.slice(0, 3).map((p) => (
                        <div key={p.category} className="text-xs text-muted-foreground">
                          {p.category}: <span className="font-medium text-foreground">{formatCurrency(p.amount)}</span>
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
      </ChartCard>
      </div>
    </div>
  );
}
