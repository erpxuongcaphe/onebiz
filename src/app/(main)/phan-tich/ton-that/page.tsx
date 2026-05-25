"use client";

/**
 * Báo cáo Tổn thất tồn kho (Phase A.2 — CEO 16/05/2026).
 *
 * Tổng hợp các phiếu xuất hủy đã hoàn tất theo:
 *   - Thời gian (date range)
 *   - Chi nhánh
 *   - Lý do hủy
 *   - Sản phẩm
 *
 * Trả lời câu hỏi quản lý:
 *   - Tháng này thiệt hại bao nhiêu? So với tháng trước?
 *   - Lý do hủy nào tốn tiền nhất? (hỏng / hết hạn / vỡ / khác)
 *   - SP nào bị hủy nhiều nhất? (review chất lượng nguyên liệu)
 *   - Chi nhánh nào tổn thất cao? (review quy trình bảo quản)
 *
 * UI: 4 KPI + Bar chart theo lý do + Bar chart theo chi nhánh + Bảng chi tiết
 * Excel: Info + Tổng theo lý do + Tổng theo SP + Tổng theo chi nhánh + Chi tiết
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
import { formatNumber, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  getDisposalLossReport,
  type DisposalLossRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

const COLORS = ["#EF4444", "#F97316", "#F59E0B", "#FBBF24", "#9CA3AF", "#6B7280"];

export default function DisposalLossReportPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { toast } = useToast();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultViewMode: "chart" });

  const [rows, setRows] = useState<DisposalLossRow[]>([]);
  const [previousPeriod, setPreviousPeriod] = useState<{
    totalLoss: number;
    disposalCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<string | "all">("all");

  // ── Fetch ──
  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getDisposalLossReport({
      branchId: activeBranchId ?? null,
      dateFrom: range.from,
      dateTo: range.to,
    })
      .then((res) => {
        setRows(res.rows);
        setPreviousPeriod(res.previousPeriod ?? null);
      })
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo tổn thất",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, range.from, range.to, toast]);

  // ── KPI ──
  const kpis = useMemo(() => {
    const totalLoss = rows.reduce((s, r) => s + r.lossValue, 0);
    const totalItems = rows.reduce((s, r) => s + r.quantity, 0);
    const disposalCount = new Set(rows.map((r) => r.disposalId)).size;
    const productCount = new Set(rows.map((r) => r.productId)).size;
    return { totalLoss, totalItems, disposalCount, productCount };
  }, [rows]);

  // ── Aggregations ──
  const byReason = useMemo(() => {
    const map = new Map<string, { value: number; items: number; count: number }>();
    for (const r of rows) {
      const ex = map.get(r.reason) ?? { value: 0, items: 0, count: 0 };
      ex.value += r.lossValue;
      ex.items += r.quantity;
      ex.count += 1;
      map.set(r.reason, ex);
    }
    return Array.from(map.entries())
      .map(([reason, data]) => ({ reason, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const byProduct = useMemo(() => {
    const map = new Map<
      string,
      { productName: string; value: number; quantity: number }
    >();
    for (const r of rows) {
      const ex = map.get(r.productId) ?? {
        productName: r.productName,
        value: 0,
        quantity: 0,
      };
      ex.value += r.lossValue;
      ex.quantity += r.quantity;
      map.set(r.productId, ex);
    }
    return Array.from(map.entries())
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const byBranch = useMemo(() => {
    const map = new Map<string, { branchName: string; value: number; count: number }>();
    for (const r of rows) {
      const key = r.branchId ?? "unknown";
      const ex = map.get(key) ?? {
        branchName: r.branchName ?? "Không xác định",
        value: 0,
        count: 0,
      };
      ex.value += r.lossValue;
      ex.count += 1;
      map.set(key, ex);
    }
    return Array.from(map.entries())
      .map(([branchId, data]) => ({ branchId, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  // ── Filter rows theo reason ──
  const filteredRows = useMemo(() => {
    if (reasonFilter === "all") return rows;
    return rows.filter((r) => r.reason === reasonFilter);
  }, [rows, reasonFilter]);

  // ── Columns ──
  const columns: DataTableColumn<DisposalLossRow>[] = [
    {
      label: "Ngày",
      key: "disposalDate",
      width: "100px",
      cell: (r) => formatDate(r.disposalDate),
    },
    { label: "Mã phiếu", key: "disposalCode", width: "120px" },
    { label: "Chi nhánh", key: "branchName", width: "140px" },
    { label: "Sản phẩm", key: "productName", width: "220px" },
    {
      label: "SL hủy",
      key: "quantity",
      align: "right",
      cell: (r) => formatNumber(r.quantity),
    },
    {
      label: "Giá vốn",
      key: "unitCost",
      align: "right",
      cell: (r) => formatCurrency(r.unitCost),
    },
    {
      label: "Tổn thất",
      key: "lossValue",
      align: "right",
      cell: (r) => (
        <span className="font-semibold text-status-error tabular-nums">
          {formatCurrency(r.lossValue)}
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
  ];

  // ── Export ──
  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {
      const branchLabel = activeBranchId ? "Chi nhánh đang chọn" : "Tất cả chi nhánh";

      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO TỔN THẤT TỒN KHO",
        description:
          "Tổng hợp xuất hủy theo lý do / sản phẩm / chi nhánh + chi tiết từng dòng",
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Báo cáo quản trị nội bộ. Giá vốn dùng snapshot tại thời điểm xuất hủy (migration 00079); phiếu cũ fallback giá vốn hiện tại.",
      });

      const reasonSheet: ExcelSheet = {
        name: "Theo lý do",
        titleRows: ["TỔN THẤT THEO LÝ DO"],
        columns: [
          { label: "Lý do", key: "reason", width: 28 },
          { label: "Số phiếu", key: "count", width: 14, format: "number" },
          { label: "SL hủy", key: "items", width: 14, format: "number" },
          { label: "Tổng tổn thất", key: "value", width: 18, format: "currency" },
        ],
        rows: byReason.map((r) => ({
          reason: r.reason,
          count: r.count,
          items: r.items,
          value: r.value,
        })),
        footer: {
          reason: "TỔNG",
          count: kpis.disposalCount,
          items: kpis.totalItems,
          value: kpis.totalLoss,
        },
      };

      const productSheet: ExcelSheet = {
        name: "Theo sản phẩm",
        titleRows: ["TỔN THẤT THEO SẢN PHẨM"],
        columns: [
          { label: "Sản phẩm", key: "productName", width: 32 },
          { label: "SL hủy", key: "quantity", width: 14, format: "number" },
          { label: "Tổng tổn thất", key: "value", width: 18, format: "currency" },
        ],
        rows: byProduct.map((r) => ({
          productName: r.productName,
          quantity: r.quantity,
          value: r.value,
        })),
        footer: {
          productName: "TỔNG",
          quantity: kpis.totalItems,
          value: kpis.totalLoss,
        },
      };

      const branchSheet: ExcelSheet = {
        name: "Theo chi nhánh",
        titleRows: ["TỔN THẤT THEO CHI NHÁNH"],
        columns: [
          { label: "Chi nhánh", key: "branchName", width: 28 },
          { label: "Số phiếu", key: "count", width: 14, format: "number" },
          { label: "Tổng tổn thất", key: "value", width: 18, format: "currency" },
        ],
        rows: byBranch.map((r) => ({
          branchName: r.branchName,
          count: r.count,
          value: r.value,
        })),
        footer: {
          branchName: "TỔNG",
          count: kpis.disposalCount,
          value: kpis.totalLoss,
        },
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết",
        titleRows: ["CHI TIẾT TỪNG DÒNG TỔN THẤT"],
        columns: [
          { label: "Ngày", key: "date", width: 12, format: "text" },
          { label: "Mã phiếu", key: "code", width: 14 },
          { label: "Chi nhánh", key: "branch", width: 22 },
          { label: "Sản phẩm", key: "product", width: 28 },
          { label: "SL", key: "qty", width: 10, format: "number" },
          { label: "Giá vốn", key: "cost", width: 14, format: "currency" },
          { label: "Tổn thất", key: "loss", width: 16, format: "currency" },
          { label: "Lý do", key: "reason", width: 24 },
        ],
        rows: rows.map((r) => ({
          date: formatDate(r.disposalDate),
          code: r.disposalCode,
          branch: r.branchName ?? "",
          product: r.productName,
          qty: r.quantity,
          cost: r.unitCost,
          loss: r.lossValue,
          reason: r.reason,
        })),
        footer: {
          date: "",
          code: "",
          branch: "",
          product: `${rows.length} dòng`,
          qty: kpis.totalItems,
          cost: "",
          loss: kpis.totalLoss,
          reason: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "hang-hoa",
        mode: "full",
        range,
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, reasonSheet, productSheet, branchSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo tổn thất",
        description: `5 sheet: Info + Theo lý do (${byReason.length}) + SP (${byProduct.length}) + Chi nhánh (${byBranch.length}) + Chi tiết (${rows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, byReason, byProduct, byBranch, kpis, range, activeBranchId, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Tổn thất tồn kho"
        subtitle="Tổng hợp xuất hủy theo lý do / SP / chi nhánh + chi tiết từng dòng"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || rows.length === 0}
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Tổng tổn thất"
          value={formatCurrency(kpis.totalLoss) + " đ"}
          change={
            previousPeriod && previousPeriod.totalLoss > 0
              ? `${kpis.totalLoss > previousPeriod.totalLoss ? "+" : ""}${(((kpis.totalLoss - previousPeriod.totalLoss) / previousPeriod.totalLoss) * 100).toFixed(1)}% so kỳ trước`
              : previousPeriod
                ? "Kỳ trước = 0"
                : undefined
          }
          positive={
            !previousPeriod ||
            (previousPeriod.totalLoss > 0 &&
              kpis.totalLoss <= previousPeriod.totalLoss)
          }
          icon="trending_down"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
        <KpiCard
          label="Số phiếu xuất hủy"
          value={formatNumber(kpis.disposalCount)}
          change={
            previousPeriod
              ? `Kỳ trước: ${formatNumber(previousPeriod.disposalCount)} phiếu`
              : undefined
          }
          positive={
            !previousPeriod || kpis.disposalCount <= previousPeriod.disposalCount
          }
          icon="receipt_long"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Số SP bị hủy"
          value={formatNumber(kpis.productCount)}
          change={`${formatNumber(kpis.totalItems)} SL hủy`}
          positive
          icon="category"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Tổn thất kỳ trước"
          value={
            previousPeriod
              ? formatCurrency(previousPeriod.totalLoss) + " đ"
              : "—"
          }
          icon="history"
          bg="bg-surface-container-low"
          iconColor="text-muted-foreground"
          valueColor="text-muted-foreground"
        />
      </div>

      {/* Chart view */}
      {viewMode === "chart" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Tổn thất theo lý do hủy"
            subtitle="Top lý do tốn kém nhất"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byReason.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 80, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                  />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    fontSize={11}
                    width={80}
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
            title="Tổn thất theo chi nhánh"
            subtitle="So sánh thiệt hại giữa các đơn vị"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byBranch}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="branchName" fontSize={11} />
                  <YAxis
                    fontSize={11}
                    tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                  />
                  <Tooltip
                    formatter={(v: unknown) =>
                      formatCurrency(Number(v) || 0) + " đ"
                    }
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#EF4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {/* Reason filter chips */}
      {byReason.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReasonFilter("all")}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              reasonFilter === "all"
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-foreground hover:bg-surface-container",
            )}
          >
            Tất cả lý do ({rows.length})
          </button>
          {byReason.slice(0, 6).map((r) => (
            <button
              key={r.reason}
              type="button"
              onClick={() => setReasonFilter(r.reason)}
              className={cn(
                "h-8 px-3 rounded-full text-xs font-medium transition-colors",
                reasonFilter === r.reason
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-low text-foreground hover:bg-surface-container",
              )}
            >
              {r.reason} ({r.count})
            </button>
          ))}
        </div>
      )}

      {/* Detail table */}
      <ReportDataTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(_r, i) => `${_r.disposalId}-${_r.productId}-${i}`}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có dữ liệu"
              : `${filteredRows.length} dòng — Tổng tổn thất: ${formatCurrency(filteredRows.reduce((s, r) => s + r.lossValue, 0))}đ`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="delete_sweep" size={40} className="opacity-50 mb-2" />
            <p>Chưa có phiếu xuất hủy nào trong kỳ này</p>
          </div>
        }
      />
    </div>
  );
}
