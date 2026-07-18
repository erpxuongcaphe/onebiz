"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  formatCurrency,
  formatNumber,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import {
  getProfitAndLoss,
  getCOGSBreakdown,
  getGrossMarginTrend,
  getInventoryTurnover,
  getDSO,
  getConsolidatedPnL,
  getBranchPnLComparison,
} from "@/lib/services";
import type {
  ProfitAndLoss,
  COGSItem,
  CogsCostBasis,
  GrossMarginTrend,
  InventoryTurnoverResult,
  DSOResult,
  ConsolidatedPnL,
  BranchPnLRow,
} from "@/lib/services/supabase/reports";
import { Icon } from "@/components/ui/icon";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatSelectedPeriodLabel } from "@/lib/utils/date-presets";

// === Helpers ===

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function describeCogsBasis(basis?: CogsCostBasis): string {
  if (!basis || basis.mode === "estimated") {
    return "Giá vốn đang ước tính theo giá vốn sản phẩm hiện tại cho dữ liệu lịch sử.";
  }
  if (basis.mode === "mixed") {
    return (
      "Giá vốn gồm " +
      basis.snapshotLines.toLocaleString("vi-VN") +
      " dòng snapshot và " +
      basis.estimatedLegacyLines.toLocaleString("vi-VN") +
      " dòng lịch sử ước tính."
    );
  }
  return "Giá vốn dùng snapshot tại thời điểm bán cho toàn bộ dòng dữ liệu.";
}

// === Custom Tooltips ===

function MarginTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
   
  payload?: Array<{ value: number; name: string; color: string; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm" style={{ color: p.color }}>
          {p.name}:{" "}
          <span className="font-bold">
            {p.dataKey === "grossMargin"
              ? `${formatNumber(p.value)}%`
              : formatChartTooltipCurrency(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

function COGSTooltip({
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

export default function BaoCaoTaiChinhPage() {
  const { toast } = useToast();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
  } = useReportState({ defaultPreset: "thisMonth", forceTable: true });
  const selectedPeriodLabel = formatSelectedPeriodLabel(preset, range);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { activeBranchId, branches, isReady } = useBranchFilter();
  const branchId = activeBranchId ?? "all";
  // CEO view: khi bật, ở chế độ "Tất cả chi nhánh" sẽ dùng getConsolidatedPnL
  // (loại trừ doanh thu/COGS nội bộ) thay vì getProfitAndLoss thông thường.
  const [ceoView, setCeoView] = useState<boolean>(false);
  const [pnl, setPnl] = useState<{
    current: ProfitAndLoss;
    previous: ProfitAndLoss;
    cogsCostBasis: {
      current: CogsCostBasis;
      previous: CogsCostBasis;
    };
  } | null>(null);
  const [consolidated, setConsolidated] = useState<{
    current: ConsolidatedPnL;
    previous: ConsolidatedPnL;
  } | null>(null);
  const [branchPnL, setBranchPnL] = useState<BranchPnLRow[]>([]);
  const [cogsItems, setCogsItems] = useState<COGSItem[]>([]);
  const [marginTrend, setMarginTrend] = useState<GrossMarginTrend[]>([]);
  const [turnover, setTurnover] = useState<InventoryTurnoverResult | null>(null);
  const [dso, setDso] = useState<DSOResult | null>(null);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    try {
      setLoading(true);
      const bid = activeBranchId;
      // Ở chế độ "Tất cả" mới load 2 report nội bộ; khi chọn 1 branch cụ thể
      // các số liệu consolidated/so sánh branch không có ý nghĩa → skip.
      const fetchConsolidated = !activeBranchId;
      const [
        pnlRes,
        cogsRes,
        marginRes,
        turnoverRes,
        dsoRes,
        consolidatedRes,
        branchPnLRes,
      ] = await Promise.all([
        getProfitAndLoss(bid, range),
        getCOGSBreakdown(10, bid, range),
        getGrossMarginTrend(6, bid),
        getInventoryTurnover(bid),
        getDSO(bid),
        fetchConsolidated
          ? getConsolidatedPnL(range)
          : Promise.resolve(null),
        fetchConsolidated
          ? getBranchPnLComparison(range)
          : Promise.resolve([] as BranchPnLRow[]),
      ]);
      setPnl(pnlRes);
      setCogsItems(cogsRes);
      setMarginTrend(marginRes);
      setTurnover(turnoverRes);
      setDso(dsoRes);
      setConsolidated(consolidatedRes);
      setBranchPnL(branchPnLRes);
    } catch (err) {
      console.error("Failed to fetch P&L data:", err);
      toast({
        title: "Lỗi tải báo cáo kết quả vận hành",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, isReady, range, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CEO view chỉ áp dụng khi đang xem "Tất cả chi nhánh".
  // Khi bật: số liệu KPI + bảng P&L dùng consolidated (đã loại trừ nội bộ).
  const useConsolidated = ceoView && branchId === "all" && !!consolidated;
  const cur = useConsolidated ? consolidated.current : pnl?.current;
  const prev = useConsolidated ? consolidated.previous : pnl?.previous;

  // Export view — 1 sheet P&L summary
  async function handleExportView() {
    if (!cur || !prev) {
      toast({
        title: "Chưa có dữ liệu để xuất",
        description: "Vui lòng chờ báo cáo tải xong.",
        variant: "error",
      });
      return;
    }
    setExporting(true);
    try {
      const branchName =
        branchId === "all"
          ? "Tất cả chi nhánh"
          : branches.find((b) => b.id === branchId)?.name ?? "";
      const titleRows = buildReportTitleRows({
        title: "Báo cáo kết quả vận hành",
        range,
        branchName,
        generatedAt: new Date(),
      });
      await exportReportToExcel({
        kind: "bao-cao-tai-chinh",
        mode: "view",
        range,
        branchName,
        sheets: [
          {
            name: "P&L",
            titleRows,
            columns: [
              { label: "Khoản mục", key: "label", width: 34 },
              { label: cur.period, key: "current", width: 18, format: "currency" },
              { label: "Tỷ lệ kỳ này", key: "currentRate", width: 14, format: "percent" },
              { label: prev.period, key: "previous", width: 18, format: "currency" },
              { label: "Tỷ lệ kỳ trước", key: "previousRate", width: 14, format: "percent" },
            ],
            rows: [
              { label: "Doanh thu hàng hóa", current: cur.goodsRevenue, previous: prev.goodsRevenue },
              { label: "Phí giao hàng thu hộ", current: cur.deliveryFee, previous: prev.deliveryFee },
              { label: "= Tổng doanh thu", current: cur.revenue, previous: prev.revenue },
              { label: "(-) Giá vốn hàng bán (COGS)", current: cur.cogs, previous: prev.cogs },
              {
                label: "= Lãi gộp",
                current: cur.grossProfit,
                currentRate: cur.grossMargin,
                previous: prev.grossProfit,
                previousRate: prev.grossMargin,
              },
              { label: "(-) Chi phí vận hành", current: cur.operatingExpense, previous: prev.operatingExpense },
              {
                label: "= Kết quả vận hành",
                current: cur.netProfit,
                currentRate: cur.netMargin,
                previous: prev.netProfit,
                previousRate: prev.netMargin,
              },
            ],
          },
        ],
      });
      toast({ title: "Đã xuất báo cáo P&L", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất báo cáo",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleExport() {
    if (!cur || !prev) {
      toast({
        title: "Chưa có dữ liệu để xuất",
        description: "Vui lòng chờ báo cáo tải xong.",
        variant: "error",
      });
      return;
    }

    setExporting(true);
    try {
      const selectedBranchName =
        branchId === "all"
          ? "Tất cả chi nhánh"
          : branches.find((branch) => branch.id === branchId)?.name ?? "";
      const costBasisNote = useConsolidated
        ? "Giá vốn hợp nhất là số liệu quản trị và cần đối soát với sổ kế toán."
        : describeCogsBasis(pnl?.cogsCostBasis.current);
      const titleRows = buildReportTitleRows({
        title: "Báo cáo kết quả vận hành",
        range,
        branchName: selectedBranchName,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        {
          name: "1. Kết quả vận hành",
          titleRows,
          columns: [
            { label: "Khoản mục", key: "label", width: 34 },
            { label: cur.period, key: "current", width: 18, format: "currency" },
            { label: "Tỷ lệ kỳ này", key: "currentRate", width: 14, format: "percent" },
            { label: prev.period, key: "previous", width: 18, format: "currency" },
            { label: "Tỷ lệ kỳ trước", key: "previousRate", width: 14, format: "percent" },
          ],
          rows: [
            { label: "Doanh thu hàng hóa", current: cur.goodsRevenue, previous: prev.goodsRevenue },
            { label: "Phí giao hàng thu hộ", current: cur.deliveryFee, previous: prev.deliveryFee },
            { label: "= Tổng doanh thu", current: cur.revenue, previous: prev.revenue },
            { label: "(-) Giá vốn hàng bán (COGS)", current: cur.cogs, previous: prev.cogs },
            {
              label: "= Lãi gộp",
              current: cur.grossProfit,
              currentRate: cur.grossMargin,
              previous: prev.grossProfit,
              previousRate: prev.grossMargin,
            },
            { label: "(-) Chi phí vận hành", current: cur.operatingExpense, previous: prev.operatingExpense },
            {
              label: "= Kết quả vận hành",
              current: cur.netProfit,
              currentRate: cur.netMargin,
              previous: prev.netProfit,
              previousRate: prev.netMargin,
            },
          ],
        },
      ];

      if (branchPnL.length > 0) {
        sheets.push({
          name: "2. Theo chi nhánh",
          columns: [
            { label: "Chi nhánh", key: "branch", width: 24 },
            { label: "Loại", key: "type", width: 12 },
            { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
            { label: "Giá vốn", key: "cogs", width: 18, format: "currency" },
            { label: "Lãi gộp", key: "grossProfit", width: 18, format: "currency" },
            { label: "Biên gộp", key: "grossMargin", width: 14, format: "percent" },
            { label: "Chi phí vận hành", key: "opEx", width: 18, format: "currency" },
            { label: "Kết quả vận hành", key: "operatingResult", width: 20, format: "currency" },
          ],
          rows: branchPnL.map((branch) => ({
            branch: branch.branchName,
            type:
              branch.branchType === "factory"
                ? "Xưởng"
                : branch.branchType === "warehouse"
                  ? "Kho"
                  : "Quán",
            revenue: branch.revenue,
            cogs: branch.cogs,
            grossProfit: branch.grossProfit,
            grossMargin: branch.grossMargin,
            opEx: branch.opEx,
            operatingResult: branch.netProfit,
          })),
        });
      }

      if (cogsItems.length > 0) {
        sheets.push({
          name: "3. Giá vốn theo SP",
          columns: [
            { label: "STT", key: "index", width: 7, format: "number" },
            { label: "Sản phẩm", key: "product", width: 30 },
            { label: "SL bán", key: "quantity", width: 12, format: "number" },
            { label: "Giá vốn/SP", key: "unitCost", width: 18, format: "currency" },
            { label: "Tổng giá vốn", key: "totalCost", width: 18, format: "currency" },
            { label: "% COGS", key: "share", width: 12, format: "percent" },
          ],
          rows: cogsItems.map((item, index) => ({
            index: index + 1,
            product: item.productName,
            quantity: item.qtySold,
            unitCost: item.costPrice,
            totalCost: item.totalCost,
            share: item.pctOfCogs,
          })),
        });
      }

      sheets.push({
        name: "4. Chỉ số vận hành",
        columns: [
          { label: "Chỉ số", key: "metric", width: 38 },
          { label: "Giá trị", key: "value", width: 20, format: "number" },
          { label: "Đơn vị", key: "unit", width: 18 },
        ],
        rows: [
          { metric: "Vòng quay tồn kho", value: turnover?.turnoverRatio ?? 0, unit: "lần/kỳ" },
          { metric: "Số ngày bán hết trung bình", value: turnover?.avgDaysToSell ?? 0, unit: "ngày" },
          { metric: "Giá vốn bán trong kỳ", value: turnover?.totalCogsPeriod ?? 0, unit: "VND" },
          { metric: "Giá trị tồn kho trung bình", value: turnover?.avgInventoryValue ?? 0, unit: "VND" },
          { metric: "Số ngày thu tiền trung bình (DSO)", value: dso?.dso ?? 0, unit: "ngày" },
          { metric: "Tổng phải thu", value: dso?.totalReceivables ?? 0, unit: "VND" },
          { metric: "Doanh thu trung bình/ngày", value: Math.round(dso?.avgDailyRevenue ?? 0), unit: "VND" },
        ],
      });

      await exportReportToExcel({
        kind: "bao-cao-tai-chinh",
        mode: "full",
        range,
        branchName: selectedBranchName,
        reportTitle: "Báo cáo kết quả vận hành",
        description:
          "Doanh thu, giá vốn, chi phí vận hành và các chỉ số quản trị theo phạm vi đã chọn.",
        disclaimer:
          "Đây là báo cáo quản trị, không phải lợi nhuận sau thuế theo chuẩn kế toán. " +
          costBasisNote,
        guide: [
          "Kết quả vận hành = doanh thu hàng hóa - giá vốn - chi phí vận hành.",
          "Phí giao hàng thu hộ được trình bày riêng và không đưa vào lãi gộp.",
          costBasisNote,
        ],
        sheets,
      });

      toast({
        title: "Đã xuất báo cáo kết quả vận hành",
        description: "File Excel đầy đủ đã được tải xuống.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Lỗi xuất báo cáo",
        description: error instanceof Error ? error.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] items-center justify-center">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Đang tải báo cáo...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      <ReportPageHeader
        title="Báo cáo kết quả vận hành"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={handleExportView}
        onExportFull={handleExport}
        exportDisabled={exporting || loading}
      />

      {branchId === "all" && (
        <div className="px-4 md:px-6 pt-3">
          <label
            className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none"
            title="Loại trừ doanh thu và giá vốn nội bộ để xem số hợp nhất toàn công ty."
          >
            <input
              type="checkbox"
              checked={ceoView}
              onChange={(event) => setCeoView(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
            />
            <span className="text-muted-foreground">
              Số hợp nhất CEO (loại trừ giao dịch nội bộ)
            </span>
          </label>
        </div>
      )}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Consolidated banner — hiển thị doanh thu nội bộ đã bị loại trừ */}
        {useConsolidated && consolidated && (
          <div className="rounded-xl border border-primary/20 bg-primary-fixed p-3 flex items-start gap-3">
            <Icon name="compare_arrows" size={20} className="text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">
                Đang xem số hợp nhất (CEO view)
              </p>
              <p className="text-xs text-primary/80 mt-0.5">
                Đã loại trừ{" "}
                <strong>
                  {formatCurrency(consolidated.current.internalRevenue)}
                </strong>{" "}
                doanh thu nội bộ (xưởng bán cho kho, kho bán cho quán) trong kỳ đã chọn.
                Kỳ trước:{" "}
                {formatCurrency(consolidated.previous.internalRevenue)}.
              </p>
            </div>
          </div>
        )}

        {!useConsolidated && pnl && (
          <div className="border-l-2 border-status-warning bg-status-warning/5 px-3 py-2 flex items-start gap-2">
            <Icon
              name="info"
              size={18}
              className="text-status-warning shrink-0 mt-0.5"
            />
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Cơ sở giá vốn:</strong>{" "}
              {describeCogsBasis(pnl.cogsCostBasis.current)} Kết quả vận hành là
              chỉ số quản trị, không phải lợi nhuận sau thuế theo chuẩn kế toán.
            </p>
          </div>
        )}

        {/* So sánh P&L các chi nhánh — chỉ hiển thị ở view "Tất cả" */}
        {branchId === "all" && branchPnL.length > 0 && (
          <ChartCard
            title="So sánh kết quả vận hành theo chi nhánh"
            subtitle="Kỳ đã chọn — xưởng rang, kho tổng, các quán FnB"
          >
            <ReportTableFrame tablePreferenceKey="report.financial-results.branches">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Chi nhánh</th>
                    <th className="text-right py-2 pr-3 font-medium">Doanh thu</th>
                    <th className="text-right py-2 pr-3 font-medium">Giá vốn</th>
                    <th className="text-right py-2 pr-3 font-medium">Lãi gộp</th>
                    <th className="text-right py-2 pr-3 font-medium">Biên gộp</th>
                    <th className="text-right py-2 pr-3 font-medium">Chi phí VH</th>
                    <th className="text-right py-2 font-medium">Kết quả vận hành</th>
                  </tr>
                </thead>
                <tbody>
                  {branchPnL.map((b) => {
                    // Map branch_type → Material Symbols icon name.
                    const typeIconName =
                      b.branchType === "factory"
                        ? "factory"
                        : b.branchType === "warehouse"
                          ? "warehouse"
                          : "storefront";
                    const typeLabel =
                      b.branchType === "factory"
                        ? "Xưởng"
                        : b.branchType === "warehouse"
                          ? "Kho"
                          : "Quán";
                    return (
                      <tr
                        key={b.branchId}
                        className="border-b last:border-0 hover:bg-surface-container-low"
                      >
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2">
                            <Icon name={typeIconName} size={14} className="text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium truncate">{b.branchName}</p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                {typeLabel}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right font-medium text-primary">
                          {formatCurrency(b.revenue)}
                        </td>
                        <td className="py-3 pr-3 text-right text-status-warning">
                          {formatCurrency(b.cogs)}
                        </td>
                        <td className="py-3 pr-3 text-right font-medium text-status-success">
                          {formatCurrency(b.grossProfit)}
                        </td>
                        <td className="py-3 pr-3 text-right text-xs">
                          <span
                            className={`inline-block px-2 py-0.5 rounded ${
                              b.grossMargin >= 30
                                ? "bg-status-success/10 text-status-success"
                                : b.grossMargin >= 15
                                  ? "bg-status-warning/10 text-status-warning"
                                  : "bg-status-error/10 text-status-error"
                            }`}
                          >
                            {b.grossMargin}%
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right text-muted-foreground">
                          {formatCurrency(b.opEx)}
                        </td>
                        <td
                          className={`py-3 text-right font-semibold ${
                            b.netProfit >= 0 ? "text-status-success" : "text-status-error"
                          }`}
                        >
                          {formatCurrency(b.netProfit)}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Tổng cộng */}
                  {(() => {
                    const sum = branchPnL.reduce(
                      (acc, b) => ({
                        revenue: acc.revenue + b.revenue,
                        cogs: acc.cogs + b.cogs,
                        grossProfit: acc.grossProfit + b.grossProfit,
                        opEx: acc.opEx + b.opEx,
                        netProfit: acc.netProfit + b.netProfit,
                      }),
                      { revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, netProfit: 0 }
                    );
                    const totalMargin =
                      sum.revenue > 0
                        ? Math.round((sum.grossProfit / sum.revenue) * 1000) / 10
                        : 0;
                    return (
                      <tr className="bg-muted/40 font-semibold">
                        <td className="py-3 pr-3">
                          Tổng toàn chuỗi ({branchPnL.length})
                        </td>
                        <td className="py-3 pr-3 text-right text-primary">
                          {formatCurrency(sum.revenue)}
                        </td>
                        <td className="py-3 pr-3 text-right text-status-warning">
                          {formatCurrency(sum.cogs)}
                        </td>
                        <td className="py-3 pr-3 text-right text-status-success">
                          {formatCurrency(sum.grossProfit)}
                        </td>
                        <td className="py-3 pr-3 text-right text-xs">
                          {totalMargin}%
                        </td>
                        <td className="py-3 pr-3 text-right text-muted-foreground">
                          {formatCurrency(sum.opEx)}
                        </td>
                        <td
                          className={`py-3 text-right ${
                            sum.netProfit >= 0 ? "text-status-success" : "text-status-error"
                          }`}
                        >
                          {formatCurrency(sum.netProfit)}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2 italic">
                Lưu ý: Tổng này <strong>chưa</strong> loại trừ doanh thu nội bộ
                — nếu muốn xem số thật của toàn chuỗi, bật công tắc{" "}
                <strong>&quot;Chỉ số CEO&quot;</strong> ở trên để so sánh.
              </p>
              </div>
            </ReportTableFrame>
          </ChartCard>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={cur ? formatCurrency(cur.revenue) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.revenue, prev.revenue)} so với kỳ trước`
                : ""
            }
            positive={cur && prev ? cur.revenue >= prev.revenue : true}
            icon="trending_up"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-primary"
          />
          <KpiCard
            label="Giá vốn hàng bán"
            value={cur ? formatCurrency(cur.cogs) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.cogs, prev.cogs)} so với kỳ trước`
                : ""
            }
            positive={cur && prev ? cur.cogs <= prev.cogs : true}
            icon="trending_down"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-status-warning"
          />
          <KpiCard
            label="Kết quả vận hành"
            value={cur ? formatCurrency(cur.netProfit) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.netProfit, prev.netProfit)} so với kỳ trước`
                : ""
            }
            positive={cur && prev ? cur.netProfit >= prev.netProfit : true}
            icon="attach_money"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-status-success"
          />
          <KpiCard
            label="Biên lợi nhuận gộp"
            value={cur ? `${cur.grossMargin}%` : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.grossMargin, prev.grossMargin)} so với kỳ trước`
                : ""
            }
            positive={
              cur && prev ? cur.grossMargin >= prev.grossMargin : true
            }
            icon="percent"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-status-info"
          />
        </div>

        {/* P&L Table */}
        <ChartCard
          title="Bảng kết quả vận hành"
          subtitle="So sánh kỳ đã chọn và kỳ liền trước"
        >
          <ReportTableFrame tablePreferenceKey="report.financial-results.comparison">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Khoản mục</th>
                  <th className="text-right py-2 pr-4 font-medium">
                    {cur?.period ?? "Kỳ hiện tại"}
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">
                    {prev?.period ?? "Kỳ trước"}
                  </th>
                  <th className="text-right py-2 font-medium">Thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Doanh thu hàng hóa",
                    cur: cur?.goodsRevenue ?? 0,
                    prev: prev?.goodsRevenue ?? 0,
                  },
                  {
                    label: "Phí giao hàng thu hộ",
                    cur: cur?.deliveryFee ?? 0,
                    prev: prev?.deliveryFee ?? 0,
                  },
                  {
                    label: "= Tổng doanh thu",
                    cur: cur?.revenue ?? 0,
                    prev: prev?.revenue ?? 0,
                    bold: true,
                    color: "text-primary",
                  },
                  {
                    label: "(-) Giá vốn hàng bán (COGS)",
                    cur: cur?.cogs ?? 0,
                    prev: prev?.cogs ?? 0,
                    negative: true,
                  },
                  {
                    label: "= Lãi gộp",
                    cur: cur?.grossProfit ?? 0,
                    prev: prev?.grossProfit ?? 0,
                    bold: true,
                    color: "text-status-success",
                  },
                  {
                    label: "   Biên LN gộp (%)",
                    cur: cur?.grossMargin ?? 0,
                    prev: prev?.grossMargin ?? 0,
                    isPercent: true,
                  },
                  {
                    label: "(-) Chi phí vận hành",
                    cur: cur?.operatingExpense ?? 0,
                    prev: prev?.operatingExpense ?? 0,
                    negative: true,
                  },
                  {
                    label: "= Kết quả vận hành",
                    cur: cur?.netProfit ?? 0,
                    prev: prev?.netProfit ?? 0,
                    bold: true,
                    color: "text-status-success",
                    highlight: true,
                  },
                  {
                    label: "   Biên KQ vận hành (%)",
                    cur: cur?.netMargin ?? 0,
                    prev: prev?.netMargin ?? 0,
                    isPercent: true,
                  },
                ].map((row) => {
                  const change = row.isPercent
                    ? `${(row.cur - row.prev).toFixed(1)}pp`
                    : pctChange(row.cur, row.prev);
                  const isPositiveChange = row.negative
                    ? row.cur <= row.prev
                    : row.cur >= row.prev;

                  return (
                    <tr
                      key={row.label}
                      className={`border-b last:border-0 ${row.highlight ? "bg-status-success/5" : ""}`}
                    >
                      <td
                        className={`py-3 pr-4 ${row.bold ? "font-semibold" : ""} ${row.color ?? ""}`}
                      >
                        {row.label}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium">
                        {row.isPercent
                          ? `${row.cur}%`
                          : formatCurrency(row.cur)}
                      </td>
                      <td className="py-3 pr-4 text-right text-muted-foreground">
                        {row.isPercent
                          ? `${row.prev}%`
                          : formatCurrency(row.prev)}
                      </td>
                      <td
                        className={`py-3 text-right text-xs font-medium ${isPositiveChange ? "text-status-success" : "text-status-error"}`}
                      >
                        {change}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </ReportTableFrame>
        </ChartCard>

        {/* Gross Margin Trend + COGS Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Gross Margin Trend */}
          <ChartCard
            title="Xu hướng biên lợi nhuận gộp"
            subtitle="6 tháng gần nhất · tham chiếu"
          >
            {marginTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={{ width: 320, height: 224 }}
                >
                  <LineChart
                    data={marginTrend}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={(v: number) => `${v}%`}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip content={<MarginTooltip />} />
                    <Legend
                      verticalAlign="top"
                      formatter={(value: string) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                    {/* Stitch palette: Doanh thu dùng primary #004AC6, COGS orange, Biên gộp green. */}
                    <Line
                      yAxisId="left"
                      type="linear"
                      dataKey="revenue"
                      stroke="#004AC6"
                      strokeWidth={2}
                      dot={{ fill: "#004AC6", r: 3 }}
                      name="Doanh thu"
                    />
                    <Line
                      yAxisId="left"
                      type="linear"
                      dataKey="cogs"
                      stroke="#ea580c"
                      strokeWidth={2}
                      dot={{ fill: "#ea580c", r: 3 }}
                      name="Giá vốn"
                    />
                    <Line
                      yAxisId="right"
                      type="linear"
                      dataKey="grossMargin"
                      stroke="#16a34a"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ fill: "#16a34a", r: 3 }}
                      name="Biên LN gộp (%)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          {/* COGS Breakdown Bar Chart */}
          <ChartCard
            title="Top sản phẩm theo giá vốn"
            subtitle={selectedPeriodLabel}
          >
            {cogsItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu giá vốn.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={{ width: 320, height: 224 }}
                >
                  <BarChart
                    data={cogsItems.slice(0, 7)}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="productName"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={100}
                    />
                    <Tooltip content={<COGSTooltip />} />
                    <Bar
                      dataKey="totalCost"
                      radius={[0, 6, 6, 0]}
                      name="Giá vốn"
                    >
                      {cogsItems.slice(0, 7).map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            index < 3
                              ? "#ea580c"
                              : index < 5
                                ? "#f97316"
                                : "#fdba74"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Operational KPIs: Inventory Turnover + DSO */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Vòng quay hàng tồn kho"
            subtitle="Tháng hiện tại"
          >
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Icon name="undo" className="size-4" />
                  <span className="text-xs">Vòng quay</span>
                </div>
                <p className="text-3xl font-bold text-primary">
                  {turnover?.turnoverRatio ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">lần/tháng</p>
              </div>
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Icon name="schedule" className="size-4" />
                  <span className="text-xs">Trung bình ngày bán hết</span>
                </div>
                <p className="text-3xl font-bold text-status-warning">
                  {turnover?.avgDaysToSell ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">ngày</p>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Giá vốn bán trong kỳ
                </span>
                <span className="font-medium">
                  {formatCurrency(turnover?.totalCogsPeriod ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Giá trị tồn kho TB
                </span>
                <span className="font-medium">
                  {formatCurrency(turnover?.avgInventoryValue ?? 0)}
                </span>
              </div>
            </div>
          </ChartCard>

          <ChartCard
            title="Số ngày thu tiền trung bình"
            subtitle="3 tháng gần nhất"
          >
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Icon name="bar_chart" className="size-4" />
                  <span className="text-xs">Số ngày thu tiền</span>
                </div>
                <p
                  className={`text-3xl font-bold ${(dso?.dso ?? 0) > 30 ? "text-status-error" : "text-status-success"}`}
                >
                  {dso?.dso ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">ngày</p>
              </div>
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Icon name="attach_money" className="size-4" />
                  <span className="text-xs">Phải thu</span>
                </div>
                <p className="text-3xl font-bold text-status-warning">
                  {formatChartCurrency(dso?.totalReceivables ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">VND</p>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Doanh thu trung bình mỗi ngày
                </span>
                <span className="font-medium">
                  {formatCurrency(Math.round(dso?.avgDailyRevenue ?? 0))}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Đánh giá</span>
                <span
                  className={`font-medium ${(dso?.dso ?? 0) <= 15 ? "text-status-success" : (dso?.dso ?? 0) <= 30 ? "text-status-warning" : "text-status-error"}`}
                >
                  {(dso?.dso ?? 0) <= 15
                    ? "Tốt"
                    : (dso?.dso ?? 0) <= 30
                      ? "Trung bình"
                      : "Cần cải thiện"}
                </span>
              </div>
            </div>
          </ChartCard>
        </div>

        {/* COGS Detail Table */}
        {cogsItems.length > 0 && (
          <ChartCard
            title="Chi tiết giá vốn theo sản phẩm"
            subtitle={selectedPeriodLabel}
          >
            <ReportTableFrame tablePreferenceKey="report.financial-results.materials">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">#</th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Sản phẩm
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      SL bán
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Giá vốn/sp
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Tổng giá vốn
                    </th>
                    <th className="text-right py-2 font-medium">
                      % COGS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cogsItems.map((item, i) => (
                    <tr
                      key={item.productName}
                      className="border-b last:border-0"
                    >
                      <td className="py-3 pr-4 text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="py-3 pr-4 font-medium">
                        {item.productName}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {formatNumber(item.qtySold)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {formatCurrency(item.costPrice)}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-status-warning">
                        {formatCurrency(item.totalCost)}
                      </td>
                      <td className="py-3 text-right">
                        <span className="inline-block bg-status-warning/10 text-status-warning px-2 py-0.5 rounded text-xs font-medium">
                          {item.pctOfCogs}%
                        </span>
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
