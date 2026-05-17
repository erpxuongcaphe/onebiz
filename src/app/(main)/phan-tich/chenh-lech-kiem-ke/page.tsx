"use client";

/**
 * Báo cáo Chênh lệch kiểm kê (Phase A.3 — CEO 16/05/2026).
 *
 * Tổng hợp các phiếu kiểm kê đã chốt (status=balanced), drill-down từng dòng
 * có chênh lệch (system_stock != actual_stock).
 *
 * Trả lời câu hỏi quản lý:
 *   - Tháng này thất thoát kho thật bao nhiêu tiền?
 *   - Chi nhánh nào thường lệch nhiều? (review quy trình kiểm soát)
 *   - SP nào hay bị thiếu / thừa nhất? (review quy trình bán / nhập)
 *   - Tỷ lệ thiếu/thừa thế nào?
 *
 * Khác báo cáo Tổn thất: ở đây là chênh lệch sổ sách vs thực tế (do mất, hỏng
 * không ghi nhận, lỗi nhập liệu). Tổn thất = có ghi nhận xuất hủy chính thức.
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
  getInventoryVarianceReport,
  type InventoryVarianceRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

type VarianceFilter = "all" | "thiếu" | "thừa";

export default function InventoryVarianceReportPage() {
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

  const [rows, setRows] = useState<InventoryVarianceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<VarianceFilter>("all");

  // ── Fetch ──
  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getInventoryVarianceReport({
      branchId: activeBranchId ?? null,
      dateFrom: range.from,
      dateTo: range.to,
    })
      .then((res) => setRows(res.rows))
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo chênh lệch",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, range.from, range.to, toast]);

  // ── KPI ──
  const kpis = useMemo(() => {
    const shortageRows = rows.filter((r) => r.varianceType === "thiếu");
    const surplusRows = rows.filter((r) => r.varianceType === "thừa");
    const shortageValue = shortageRows.reduce(
      (s, r) => s + Math.abs(r.varianceValue),
      0,
    );
    const surplusValue = surplusRows.reduce((s, r) => s + r.varianceValue, 0);
    const netLoss = shortageValue - surplusValue;
    const checkCount = new Set(rows.map((r) => r.checkId)).size;
    return {
      shortageValue,
      surplusValue,
      netLoss,
      shortageCount: shortageRows.length,
      surplusCount: surplusRows.length,
      checkCount,
    };
  }, [rows]);

  // ── Aggregations ──
  const byBranch = useMemo(() => {
    const map = new Map<
      string,
      { branchName: string; shortage: number; surplus: number; rowCount: number }
    >();
    for (const r of rows) {
      const key = r.branchId ?? "unknown";
      const ex = map.get(key) ?? {
        branchName: r.branchName ?? "Không xác định",
        shortage: 0,
        surplus: 0,
        rowCount: 0,
      };
      if (r.varianceType === "thiếu") {
        ex.shortage += Math.abs(r.varianceValue);
      } else if (r.varianceType === "thừa") {
        ex.surplus += r.varianceValue;
      }
      ex.rowCount += 1;
      map.set(key, ex);
    }
    return Array.from(map.entries())
      .map(([branchId, data]) => ({ branchId, ...data, net: data.shortage - data.surplus }))
      .sort((a, b) => b.net - a.net);
  }, [rows]);

  const byProduct = useMemo(() => {
    const map = new Map<
      string,
      { productName: string; totalDiff: number; totalValue: number; count: number }
    >();
    for (const r of rows) {
      const ex = map.get(r.productId) ?? {
        productName: r.productName,
        totalDiff: 0,
        totalValue: 0,
        count: 0,
      };
      ex.totalDiff += r.difference;
      ex.totalValue += r.varianceValue;
      ex.count += 1;
      map.set(r.productId, ex);
    }
    return Array.from(map.entries())
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => a.totalValue - b.totalValue); // âm trước (thiếu nhiều nhất)
  }, [rows]);

  // ── Filter ──
  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.varianceType === filter);
  }, [rows, filter]);

  // ── Columns ──
  const columns: DataTableColumn<InventoryVarianceRow>[] = [
    {
      label: "Ngày kiểm",
      key: "checkDate",
      width: "110px",
      cell: (r) => formatDate(r.checkDate),
    },
    { label: "Mã phiếu", key: "checkCode", width: "120px" },
    { label: "Chi nhánh", key: "branchName", width: "140px" },
    { label: "Sản phẩm", key: "productName", width: "220px" },
    {
      label: "Sổ sách",
      key: "systemStock",
      align: "right",
      cell: (r) => formatNumber(r.systemStock),
    },
    {
      label: "Thực tế",
      key: "actualStock",
      align: "right",
      cell: (r) => formatNumber(r.actualStock),
    },
    {
      label: "Lệch",
      key: "difference",
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            r.difference < 0 && "text-status-error",
            r.difference > 0 && "text-status-success",
          )}
        >
          {r.difference > 0 ? "+" : ""}
          {formatNumber(r.difference)}
        </span>
      ),
    },
    {
      label: "% Lệch",
      key: "differencePercent",
      align: "right",
      cell: (r) => {
        if (r.systemStock === 0) return "—";
        const pct = (r.difference / r.systemStock) * 100;
        const abs = Math.abs(pct);
        return (
          <span
            className={cn(
              "font-semibold tabular-nums",
              abs > 20
                ? "text-status-error"
                : abs > 10
                  ? "text-status-warning"
                  : "text-muted-foreground",
            )}
          >
            {pct > 0 ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        );
      },
    },
    {
      label: "Giá trị lệch",
      key: "varianceValue",
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            r.varianceValue < 0 && "text-status-error",
            r.varianceValue > 0 && "text-status-success",
          )}
        >
          {r.varianceValue > 0 ? "+" : ""}
          {formatCurrency(r.varianceValue)}
        </span>
      ),
    },
    {
      label: "Loại",
      key: "varianceType",
      align: "center",
      cell: (r) => (
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium",
            r.varianceType === "thiếu" && "bg-status-error/10 text-status-error",
            r.varianceType === "thừa" && "bg-status-success/10 text-status-success",
            r.varianceType === "khớp" && "bg-muted text-muted-foreground",
          )}
        >
          {r.varianceType}
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
        title: "BÁO CÁO CHÊNH LỆCH KIỂM KÊ",
        description:
          "Sai lệch giữa sổ sách và thực tế từ các phiếu kiểm kê đã chốt",
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Báo cáo quản trị nội bộ. Giá trị lệch tính theo unit_cost snapshot tại thời điểm kiểm (00079); phiếu cũ fallback giá vốn hiện tại. CFO dùng để impair tồn kho.",
      });

      const branchSheet: ExcelSheet = {
        name: "Theo chi nhánh",
        titleRows: ["CHÊNH LỆCH THEO CHI NHÁNH"],
        columns: [
          { label: "Chi nhánh", key: "branchName", width: 24 },
          { label: "Số dòng lệch", key: "rowCount", width: 14, format: "number" },
          { label: "Giá trị thiếu", key: "shortage", width: 18, format: "currency" },
          { label: "Giá trị thừa", key: "surplus", width: 18, format: "currency" },
          { label: "Net (thiếu − thừa)", key: "net", width: 18, format: "currency" },
        ],
        rows: byBranch.map((b) => ({
          branchName: b.branchName,
          rowCount: b.rowCount,
          shortage: b.shortage,
          surplus: b.surplus,
          net: b.net,
        })),
        footer: {
          branchName: "TỔNG",
          rowCount: rows.length,
          shortage: kpis.shortageValue,
          surplus: kpis.surplusValue,
          net: kpis.netLoss,
        },
      };

      const productSheet: ExcelSheet = {
        name: "Theo sản phẩm",
        titleRows: ["CHÊNH LỆCH THEO SẢN PHẨM"],
        columns: [
          { label: "Sản phẩm", key: "productName", width: 30 },
          { label: "Số lần lệch", key: "count", width: 14, format: "number" },
          { label: "Tổng lệch SL", key: "totalDiff", width: 14, format: "number" },
          { label: "Giá trị lệch", key: "value", width: 18, format: "currency" },
        ],
        rows: byProduct.map((p) => ({
          productName: p.productName,
          count: p.count,
          totalDiff: p.totalDiff,
          value: p.totalValue,
        })),
        footer: {
          productName: "TỔNG",
          count: rows.length,
          totalDiff: rows.reduce((s, r) => s + r.difference, 0),
          value: rows.reduce((s, r) => s + r.varianceValue, 0),
        },
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết",
        titleRows: ["CHI TIẾT TỪNG DÒNG LỆCH"],
        columns: [
          { label: "Ngày", key: "date", width: 12, format: "text" },
          { label: "Mã phiếu", key: "code", width: 14 },
          { label: "Chi nhánh", key: "branch", width: 20 },
          { label: "Sản phẩm", key: "product", width: 28 },
          { label: "Sổ", key: "system", width: 10, format: "number" },
          { label: "Thực", key: "actual", width: 10, format: "number" },
          { label: "Lệch", key: "diff", width: 10, format: "number" },
          { label: "Giá vốn", key: "cost", width: 14, format: "currency" },
          { label: "Giá trị lệch", key: "value", width: 16, format: "currency" },
          { label: "Loại", key: "type", width: 10 },
        ],
        rows: rows.map((r) => ({
          date: formatDate(r.checkDate),
          code: r.checkCode,
          branch: r.branchName ?? "",
          product: r.productName,
          system: r.systemStock,
          actual: r.actualStock,
          diff: r.difference,
          cost: r.unitCost,
          value: r.varianceValue,
          type: r.varianceType,
        })),
        footer: {
          date: "",
          code: "",
          branch: "",
          product: `${rows.length} dòng`,
          system: "",
          actual: "",
          diff: rows.reduce((s, r) => s + r.difference, 0),
          cost: "",
          value: rows.reduce((s, r) => s + r.varianceValue, 0),
          type: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "hang-hoa",
        mode: "full",
        range,
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, branchSheet, productSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo chênh lệch",
        description: `4 sheet: Info + Chi nhánh (${byBranch.length}) + SP (${byProduct.length}) + Chi tiết (${rows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, byBranch, byProduct, kpis, range, activeBranchId, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Chênh lệch kiểm kê"
        subtitle="Sai lệch sổ sách vs thực tế — phân tích thất thoát kho thật"
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Giá trị thiếu (mất)"
          value={formatCurrency(kpis.shortageValue) + " đ"}
          change={`${kpis.shortageCount} dòng`}
          positive={false}
          icon="trending_down"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
        <KpiCard
          label="Giá trị thừa"
          value={formatCurrency(kpis.surplusValue) + " đ"}
          change={`${kpis.surplusCount} dòng`}
          positive={true}
          icon="trending_up"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="Net thất thoát"
          value={formatCurrency(kpis.netLoss) + " đ"}
          icon="balance"
          bg={kpis.netLoss > 0 ? "bg-status-error/10" : "bg-status-success/10"}
          iconColor={kpis.netLoss > 0 ? "text-status-error" : "text-status-success"}
          valueColor={kpis.netLoss > 0 ? "text-status-error" : "text-status-success"}
        />
        <KpiCard
          label="Số phiếu kiểm"
          value={formatNumber(kpis.checkCount)}
          icon="fact_check"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
      </div>

      {/* Chart view */}
      {viewMode === "chart" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {byBranch.length > 0 && (
            <ChartCard
              title="Thất thoát ròng theo chi nhánh"
              subtitle="Net = giá trị thiếu − giá trị thừa (cao = lệch nhiều)"
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
                      formatter={(v: unknown, key: unknown) => [
                        formatCurrency(Number(v) || 0) + " đ",
                        String(key),
                      ]}
                    />
                    <Bar dataKey="shortage" name="Thiếu" stackId="x" radius={[0, 0, 0, 0]}>
                      {byBranch.map((_, i) => (
                        <Cell key={i} fill="#EF4444" />
                      ))}
                    </Bar>
                    <Bar dataKey="surplus" name="Thừa" stackId="x" radius={[6, 6, 0, 0]}>
                      {byBranch.map((_, i) => (
                        <Cell key={i} fill="#10B981" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {byProduct.length > 0 && (
            <ChartCard
              title="Top 10 SP lệch nhiều nhất"
              subtitle="Sắp theo giá trị lệch tuyệt đối — review chất lượng / quy trình"
            >
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart
                    data={byProduct
                      .slice(0, 10)
                      .map((p) => ({ ...p, absValue: Math.abs(p.totalValue) }))}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: 100, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      fontSize={11}
                      tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                    />
                    <YAxis
                      type="category"
                      dataKey="productName"
                      fontSize={10}
                      width={100}
                    />
                    <Tooltip
                      formatter={(v: unknown) =>
                        formatCurrency(Number(v) || 0) + " đ"
                      }
                    />
                    <Bar dataKey="absValue" name="Giá trị lệch" radius={[0, 4, 4, 0]}>
                      {byProduct.slice(0, 10).map((p, i) => (
                        <Cell
                          key={i}
                          fill={p.totalValue < 0 ? "#EF4444" : "#10B981"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: `Tất cả (${rows.length})` },
            { key: "thiếu", label: `Thiếu (${kpis.shortageCount})` },
            { key: "thừa", label: `Thừa (${kpis.surplusCount})` },
          ] as { key: VarianceFilter; label: string }[]
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              filter === chip.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-foreground hover:bg-surface-container",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Detail table */}
      <ReportDataTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(r, i) => `${r.checkId}-${r.productId}-${i}`}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có chênh lệch trong kỳ"
              : `${filteredRows.length} dòng — Net: ${formatCurrency(filteredRows.reduce((s, r) => s + r.varianceValue, 0))}đ`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="fact_check" size={40} className="opacity-50 mb-2" />
            <p>Chưa có phiếu kiểm kê nào có chênh lệch trong kỳ</p>
          </div>
        }
      />
    </div>
  );
}
