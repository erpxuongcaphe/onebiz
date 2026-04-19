"use client";

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { getClient } from "@/lib/services/supabase/base";
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
import { DateRangeBar, KpiCard, ChartCard } from "../_components";
import {
  formatCurrency,
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
  GrossMarginTrend,
  InventoryTurnoverResult,
  DSOResult,
  ConsolidatedPnL,
  BranchPnLRow,
} from "@/lib/services/supabase/reports";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";

// === Helpers ===

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// === Custom Tooltips ===

function MarginTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              ? `${p.value}%`
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
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [branchId, setBranchId] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  // CEO view: khi bật, ở chế độ "Tất cả chi nhánh" sẽ dùng getConsolidatedPnL
  // (loại trừ doanh thu/COGS nội bộ) thay vì getProfitAndLoss thông thường.
  const [ceoView, setCeoView] = useState<boolean>(false);
  const [pnl, setPnl] = useState<{
    current: ProfitAndLoss;
    previous: ProfitAndLoss;
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

  // Fetch branches once
  useEffect(() => {
    (async () => {
      const supabase = getClient();
      const { data } = await supabase.from("branches").select("id, name").eq("is_active", true);
      setBranches((data ?? []).map(b => ({ id: b.id, name: b.name })));
    })();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const bid = branchId === "all" ? undefined : branchId;
      // Ở chế độ "Tất cả" mới load 2 report nội bộ; khi chọn 1 branch cụ thể
      // các số liệu consolidated/so sánh branch không có ý nghĩa → skip.
      const fetchConsolidated = branchId === "all";
      const [
        pnlRes,
        cogsRes,
        marginRes,
        turnoverRes,
        dsoRes,
        consolidatedRes,
        branchPnLRes,
      ] = await Promise.all([
        getProfitAndLoss(bid),
        getCOGSBreakdown(10, bid),
        getGrossMarginTrend(6, bid),
        getInventoryTurnover(bid),
        getDSO(bid),
        fetchConsolidated
          ? getConsolidatedPnL()
          : Promise.resolve(null),
        fetchConsolidated
          ? getBranchPnLComparison()
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
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CEO view chỉ áp dụng khi đang xem "Tất cả chi nhánh".
  // Khi bật: số liệu KPI + bảng P&L dùng consolidated (đã loại trừ nội bộ).
  const useConsolidated = ceoView && branchId === "all" && !!consolidated;
  const cur = useConsolidated ? consolidated.current : pnl?.current;
  const prev = useConsolidated ? consolidated.previous : pnl?.previous;

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
      const wb = XLSX.utils.book_new();

      // Sheet 1: P&L summary
      const pnlRows = [
        { "Khoản mục": "Doanh thu", [cur.period]: cur.revenue, [prev.period]: prev.revenue },
        { "Khoản mục": "(-) Giá vốn hàng bán (COGS)", [cur.period]: cur.cogs, [prev.period]: prev.cogs },
        { "Khoản mục": "= Lãi gộp", [cur.period]: cur.grossProfit, [prev.period]: prev.grossProfit },
        { "Khoản mục": "   Biên LN gộp (%)", [cur.period]: cur.grossMargin, [prev.period]: prev.grossMargin },
        { "Khoản mục": "(-) Chi phí vận hành", [cur.period]: cur.operatingExpense, [prev.period]: prev.operatingExpense },
        { "Khoản mục": "= Lãi ròng", [cur.period]: cur.netProfit, [prev.period]: prev.netProfit },
        { "Khoản mục": "   Biên LN ròng (%)", [cur.period]: cur.netMargin, [prev.period]: prev.netMargin },
      ];
      const pnlSheet = XLSX.utils.json_to_sheet(pnlRows);
      pnlSheet["!cols"] = [{ wch: 32 }, { wch: 18 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, pnlSheet, "Lãi-Lỗ");

      // Sheet 2: Branch comparison (if available)
      if (branchPnL.length > 0) {
        const branchRows = branchPnL.map((b) => ({
          "Chi nhánh": b.branchName,
          "Loại":
            b.branchType === "factory"
              ? "Xưởng"
              : b.branchType === "warehouse"
                ? "Kho"
                : "Quán",
          "Doanh thu": b.revenue,
          "Giá vốn": b.cogs,
          "Lãi gộp": b.grossProfit,
          "Biên gộp (%)": b.grossMargin,
          "Chi phí VH": b.opEx,
          "Lãi ròng": b.netProfit,
        }));
        const branchSheet = XLSX.utils.json_to_sheet(branchRows);
        branchSheet["!cols"] = [
          { wch: 22 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
        ];
        XLSX.utils.book_append_sheet(wb, branchSheet, "Theo chi nhánh");
      }

      // Sheet 3: COGS by product
      if (cogsItems.length > 0) {
        const cogsRows = cogsItems.map((c, i) => ({
          "STT": i + 1,
          "Sản phẩm": c.productName,
          "SL bán": c.qtySold,
          "Giá vốn/sp": c.costPrice,
          "Tổng giá vốn": c.totalCost,
          "% COGS": c.pctOfCogs,
        }));
        const cogsSheet = XLSX.utils.json_to_sheet(cogsRows);
        cogsSheet["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, cogsSheet, "Giá vốn theo SP");
      }

      // Sheet 4: Operational KPIs
      const opKpiRows = [
        { "Chỉ số": "Vòng quay tồn kho (lần/tháng)", "Giá trị": turnover?.turnoverRatio ?? 0 },
        { "Chỉ số": "Số ngày bán hết TB", "Giá trị": turnover?.avgDaysToSell ?? 0 },
        { "Chỉ số": "Giá vốn bán trong kỳ", "Giá trị": turnover?.totalCogsPeriod ?? 0 },
        { "Chỉ số": "Giá trị tồn kho TB", "Giá trị": turnover?.avgInventoryValue ?? 0 },
        { "Chỉ số": "Số ngày thu tiền TB (DSO)", "Giá trị": dso?.dso ?? 0 },
        { "Chỉ số": "Tổng phải thu", "Giá trị": dso?.totalReceivables ?? 0 },
        { "Chỉ số": "Doanh thu TB/ngày", "Giá trị": Math.round(dso?.avgDailyRevenue ?? 0) },
      ];
      const opSheet = XLSX.utils.json_to_sheet(opKpiRows);
      opSheet["!cols"] = [{ wch: 32 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, opSheet, "Chỉ số vận hành");

      // Write file
      const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const branchLabel =
        branchId === "all"
          ? "tat-ca-chi-nhanh"
          : branches.find((b) => b.id === branchId)?.name
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "") ?? "chi-nhanh";
      const today = new Date().toISOString().slice(0, 10);
      saveAs(blob, `bao-cao-tai-chinh-${branchLabel}-${today}.xlsx`);

      toast({
        title: "Đã xuất báo cáo tài chính",
        description: "File Excel đã được tải xuống.",
        variant: "success",
      });
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
      <DateRangeBar
        title="Báo cáo tài chính (P&L)"
        subtitle="Lãi/Lỗ, Giá vốn, Biên lợi nhuận"
        onExport={handleExport}
        exportDisabled={exporting || loading}
      />

      {/* Branch filter + CEO toggle */}
      {branches.length > 1 && (
        <div className="px-4 md:px-6 pt-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon name="apartment" size={16} className="text-muted-foreground" />
            <Select value={branchId} onValueChange={(v) => setBranchId(v ?? "all")}>
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="Tất cả chi nhánh" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả chi nhánh</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* CEO view toggle — chỉ enable khi xem tổng hợp tất cả branch */}
          {branchId === "all" && (
            <label
              className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none"
              title="Loại trừ doanh thu/COGS nội bộ (xưởng bán cho kho, kho bán cho quán) để thấy số thật của toàn chuỗi."
            >
              <input
                type="checkbox"
                checked={ceoView}
                onChange={(e) => setCeoView(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-muted-foreground">
                Chỉ số CEO (loại trừ doanh thu nội bộ)
              </span>
            </label>
          )}
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
                doanh thu nội bộ (xưởng bán cho kho, kho bán cho quán) trong tháng này.
                Kỳ trước:{" "}
                {formatCurrency(consolidated.previous.internalRevenue)}.
              </p>
            </div>
          </div>
        )}

        {/* So sánh P&L các chi nhánh — chỉ hiển thị ở view "Tất cả" */}
        {branchId === "all" && branchPnL.length > 0 && (
          <ChartCard
            title="So sánh lãi lỗ theo chi nhánh"
            subtitle="Tháng hiện tại — xưởng rang, kho tổng, các quán FnB"
          >
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
                    <th className="text-right py-2 font-medium">Lãi ròng</th>
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
                        <td className="py-2.5 pr-3">
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
                        <td className="py-2.5 pr-3 text-right font-medium text-primary">
                          {formatCurrency(b.revenue)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-status-warning">
                          {formatCurrency(b.cogs)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium text-status-success">
                          {formatCurrency(b.grossProfit)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-xs">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded ${
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
                        <td className="py-2.5 pr-3 text-right text-muted-foreground">
                          {formatCurrency(b.opEx)}
                        </td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
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
                        <td className="py-2.5 pr-3">
                          Tổng toàn chuỗi ({branchPnL.length})
                        </td>
                        <td className="py-2.5 pr-3 text-right text-primary">
                          {formatCurrency(sum.revenue)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-status-warning">
                          {formatCurrency(sum.cogs)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-status-success">
                          {formatCurrency(sum.grossProfit)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-xs">
                          {totalMargin}%
                        </td>
                        <td className="py-2.5 pr-3 text-right text-muted-foreground">
                          {formatCurrency(sum.opEx)}
                        </td>
                        <td
                          className={`py-2.5 text-right ${
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
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                Lưu ý: Tổng này <strong>chưa</strong> loại trừ doanh thu nội bộ
                — nếu muốn xem số thật của toàn chuỗi, bật công tắc{" "}
                <strong>&quot;Chỉ số CEO&quot;</strong> ở trên để so sánh.
              </p>
            </div>
          </ChartCard>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={cur ? formatCurrency(cur.revenue) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.revenue, prev.revenue)} so với tháng trước`
                : ""
            }
            positive={cur && prev ? cur.revenue >= prev.revenue : true}
            icon="trending_up"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-primary"
          />
          <KpiCard
            label="Giá vốn (COGS)"
            value={cur ? formatCurrency(cur.cogs) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.cogs, prev.cogs)} so với tháng trước`
                : ""
            }
            positive={cur && prev ? cur.cogs <= prev.cogs : true}
            icon="trending_down"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-status-warning"
          />
          <KpiCard
            label="Lãi ròng"
            value={cur ? formatCurrency(cur.netProfit) : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.netProfit, prev.netProfit)} so với tháng trước`
                : ""
            }
            positive={cur && prev ? cur.netProfit >= prev.netProfit : true}
            icon="attach_money"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-status-success"
          />
          <KpiCard
            label="Biên LN gộp"
            value={cur ? `${cur.grossMargin}%` : "—"}
            change={
              cur && prev
                ? `${pctChange(cur.grossMargin, prev.grossMargin)} so với tháng trước`
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
          title="Bảng Lãi/Lỗ (P&L)"
          subtitle="So sánh tháng hiện tại và tháng trước"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Khoản mục</th>
                  <th className="text-right py-2 pr-4 font-medium">
                    {cur?.period ?? "Tháng này"}
                  </th>
                  <th className="text-right py-2 pr-4 font-medium">
                    {prev?.period ?? "Tháng trước"}
                  </th>
                  <th className="text-right py-2 font-medium">Thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Doanh thu",
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
                    label: "= Lãi ròng",
                    cur: cur?.netProfit ?? 0,
                    prev: prev?.netProfit ?? 0,
                    bold: true,
                    color: "text-status-success",
                    highlight: true,
                  },
                  {
                    label: "   Biên LN ròng (%)",
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
                        className={`py-2.5 pr-4 ${row.bold ? "font-semibold" : ""} ${row.color ?? ""}`}
                      >
                        {row.label}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium">
                        {row.isPercent
                          ? `${row.cur}%`
                          : formatCurrency(row.cur)}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-muted-foreground">
                        {row.isPercent
                          ? `${row.prev}%`
                          : formatCurrency(row.prev)}
                      </td>
                      <td
                        className={`py-2.5 text-right text-xs font-medium ${isPositiveChange ? "text-status-success" : "text-status-error"}`}
                      >
                        {change}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>

        {/* Gross Margin Trend + COGS Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Gross Margin Trend */}
          <ChartCard
            title="Xu hướng biên lợi nhuận gộp"
            subtitle="6 tháng gần nhất"
          >
            {marginTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
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
                      type="monotone"
                      dataKey="revenue"
                      stroke="#004AC6"
                      strokeWidth={2}
                      dot={{ fill: "#004AC6", r: 3 }}
                      name="Doanh thu"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="cogs"
                      stroke="#ea580c"
                      strokeWidth={2}
                      dot={{ fill: "#ea580c", r: 3 }}
                      name="Giá vốn"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
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
            subtitle="Tháng hiện tại"
          >
            {cogsItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Chưa có dữ liệu giá vốn.
              </p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
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
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Icon name="undo" className="size-4" />
                  <span className="text-xs">Vòng quay</span>
                </div>
                <p className="text-3xl font-bold text-primary">
                  {turnover?.turnoverRatio ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">lần/tháng</p>
              </div>
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Icon name="schedule" className="size-4" />
                  <span className="text-xs">TB ngày bán hết</span>
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
            title="Số ngày thu tiền TB (DSO)"
            subtitle="3 tháng gần nhất"
          >
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Icon name="bar_chart" className="size-4" />
                  <span className="text-xs">DSO</span>
                </div>
                <p
                  className={`text-3xl font-bold ${(dso?.dso ?? 0) > 30 ? "text-status-error" : "text-status-success"}`}
                >
                  {dso?.dso ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">ngày</p>
              </div>
              <div className="text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
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
                  Doanh thu TB/ngày
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
            subtitle="Tháng hiện tại"
          >
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
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="py-2.5 pr-4 font-medium">
                        {item.productName}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {item.qtySold.toLocaleString("vi-VN")}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {formatCurrency(item.costPrice)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium text-status-warning">
                        {formatCurrency(item.totalCost)}
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="inline-block bg-status-warning/10 text-status-warning px-1.5 py-0.5 rounded text-xs font-medium">
                          {item.pctOfCogs}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
