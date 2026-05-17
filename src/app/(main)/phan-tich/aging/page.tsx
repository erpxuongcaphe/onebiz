"use client";

/**
 * Báo cáo Aging tồn kho / Dead-stock (Phase A.1 — CEO 16/05/2026).
 *
 * Trả lời câu hỏi:
 *   - SP nào nằm kho lâu nhất? (aging bucket 0-30 / 31-60 / 61-90 / 91+)
 *   - SP nào KHÔNG bán được >60 ngày + còn tồn → dead-stock?
 *   - Tổng giá trị vốn chết trong kho là bao nhiêu?
 *
 * UI:
 *   - Tổng quan: 4 KPI (tổng giá trị tồn / SL SP dead / % dead / giá trị vốn chết)
 *   - Chart: Bar chart phân bổ giá trị theo bucket
 *   - Bảng chi tiết: DataTable drill-down filter theo bucket
 *   - Excel export: Info + Tổng quan + Chi tiết + Dead-stock list (4 sheet)
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
  getInventoryAgingReport,
  type InventoryAgingRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

type BucketFilter = "all" | "0-30" | "31-60" | "61-90" | "91+" | "dead";

const BUCKET_LABELS: Record<string, string> = {
  "0-30": "0 – 30 ngày",
  "31-60": "31 – 60 ngày",
  "61-90": "61 – 90 ngày",
  "91+": "Trên 90 ngày",
  unknown: "Không xác định",
};

const BUCKET_COLORS: Record<string, string> = {
  "0-30": "#10B981",
  "31-60": "#F59E0B",
  "61-90": "#F97316",
  "91+": "#EF4444",
  unknown: "#9CA3AF",
};

export default function AgingReportPage() {
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

  const [rows, setRows] = useState<InventoryAgingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>("all");

  // ── Fetch ──
  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getInventoryAgingReport({ branchId: activeBranchId ?? null })
      .then((res) => setRows(res.rows))
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo aging",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, toast]);

  // ── KPI tổng quan ──
  const kpis = useMemo(() => {
    const totalSku = rows.length;
    const totalValue = rows.reduce((s, r) => s + r.stockValue, 0);
    const deadRows = rows.filter((r) => r.isDeadStock);
    const deadCount = deadRows.length;
    const deadValue = deadRows.reduce((s, r) => s + r.stockValue, 0);
    const deadPercent = totalSku > 0 ? (deadCount / totalSku) * 100 : 0;
    return { totalSku, totalValue, deadCount, deadValue, deadPercent };
  }, [rows]);

  // ── Bucket aggregation cho chart ──
  const bucketAgg = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>();
    for (const r of rows) {
      const k = r.agingBucket;
      const ex = map.get(k) ?? { count: 0, value: 0 };
      ex.count += 1;
      ex.value += r.stockValue;
      map.set(k, ex);
    }
    const order = ["0-30", "31-60", "61-90", "91+", "unknown"];
    return order
      .filter((k) => map.has(k))
      .map((k) => ({
        bucket: BUCKET_LABELS[k] ?? k,
        bucketKey: k,
        count: map.get(k)!.count,
        value: map.get(k)!.value,
      }));
  }, [rows]);

  // ── Filter rows theo bucket ──
  const filteredRows = useMemo(() => {
    if (bucketFilter === "all") return rows;
    if (bucketFilter === "dead") return rows.filter((r) => r.isDeadStock);
    return rows.filter((r) => r.agingBucket === bucketFilter);
  }, [rows, bucketFilter]);

  // ── Columns table ──
  const columns: DataTableColumn<InventoryAgingRow>[] = [
    { label: "Mã SP", key: "code", width: "100px" },
    { label: "Tên sản phẩm", key: "name", width: "240px" },
    {
      label: "Tồn",
      key: "currentQty",
      align: "right",
      cell: (r) => formatNumber(r.currentQty),
    },
    {
      label: "Giá vốn",
      key: "costPrice",
      align: "right",
      cell: (r) => formatCurrency(r.costPrice),
    },
    {
      label: "Giá trị tồn",
      key: "stockValue",
      align: "right",
      cell: (r) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(r.stockValue)}
        </span>
      ),
    },
    {
      label: "Ngày nhập cuối",
      key: "lastInDate",
      align: "center",
      cell: (r) => (r.lastInDate ? formatDate(r.lastInDate) : "—"),
    },
    {
      label: "Tồn ngày",
      key: "daysInStock",
      align: "right",
      cell: (r) => (r.daysInStock !== null ? `${r.daysInStock}d` : "—"),
    },
    {
      label: "Bán cuối",
      key: "lastSaleDate",
      align: "center",
      cell: (r) => (r.lastSaleDate ? formatDate(r.lastSaleDate) : "—"),
    },
    {
      label: "Nhóm aging",
      key: "agingBucket",
      align: "center",
      cell: (r) => (
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
            r.agingBucket === "0-30" && "bg-status-success/10 text-status-success",
            r.agingBucket === "31-60" && "bg-status-warning/10 text-status-warning",
            r.agingBucket === "61-90" &&
              "bg-status-warning/10 text-status-warning",
            r.agingBucket === "91+" && "bg-status-error/10 text-status-error",
            r.agingBucket === "unknown" && "bg-muted text-muted-foreground",
          )}
        >
          {BUCKET_LABELS[r.agingBucket] ?? r.agingBucket}
        </span>
      ),
    },
    {
      label: "Dead-stock",
      key: "isDeadStock",
      align: "center",
      cell: (r) =>
        r.isDeadStock ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-status-error/10 text-status-error">
            <Icon name="warning" size={12} />
            Có
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  // ── Excel export ──
  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {
      const branchLabel = activeBranchId ? "Chi nhánh đang chọn" : "Tất cả chi nhánh";
      const today = new Date().toISOString().slice(0, 10);
      const dateRange = { from: today, to: today };

      // Sheet 0: Info
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO AGING TỒN KHO / DEAD-STOCK",
        description:
          "Phân loại tồn kho theo thời gian nằm kho + danh sách dead-stock",
        range: dateRange,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Báo cáo snapshot tại thời điểm xuất file. Dead-stock = SP có tồn > 0 nhưng không bán trong 60 ngày gần nhất.",
      });

      // Sheet 1: Tổng quan theo bucket
      const overviewSheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: ["TỔNG QUAN AGING TỒN KHO"],
        columns: [
          { label: "Nhóm thời gian", key: "bucket", width: 24 },
          { label: "Số SP", key: "count", width: 14, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: bucketAgg.map((b) => ({
          bucket: b.bucket,
          count: b.count,
          value: b.value,
        })),
        footer: {
          bucket: "TỔNG",
          count: kpis.totalSku,
          value: kpis.totalValue,
        },
      };

      // Sheet 2: Chi tiết toàn bộ
      const detailSheet: ExcelSheet = {
        name: "Chi tiết",
        titleRows: ["CHI TIẾT TỪNG SẢN PHẨM"],
        columns: [
          { label: "Mã SP", key: "code", width: 12 },
          { label: "Tên SP", key: "name", width: 30 },
          { label: "Tồn", key: "qty", width: 12, format: "number" },
          { label: "Giá vốn", key: "cost", width: 14, format: "currency" },
          { label: "Giá trị tồn", key: "value", width: 16, format: "currency" },
          { label: "Ngày nhập cuối", key: "lastIn", width: 14, format: "text" },
          { label: "Tồn ngày", key: "days", width: 12, format: "number" },
          { label: "Bán cuối", key: "lastSale", width: 14, format: "text" },
          { label: "Nhóm aging", key: "bucket", width: 16 },
          { label: "Dead-stock", key: "dead", width: 12 },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          name: r.name,
          qty: r.currentQty,
          cost: r.costPrice,
          value: r.stockValue,
          lastIn: r.lastInDate ? formatDate(r.lastInDate) : "—",
          days: r.daysInStock ?? 0,
          lastSale: r.lastSaleDate ? formatDate(r.lastSaleDate) : "—",
          bucket: BUCKET_LABELS[r.agingBucket] ?? r.agingBucket,
          dead: r.isDeadStock ? "Có" : "—",
        })),
        footer: {
          code: "",
          name: `${rows.length} SP — TỔNG GIÁ TRỊ`,
          qty: rows.reduce((s, r) => s + r.currentQty, 0),
          cost: "",
          value: kpis.totalValue,
          lastIn: "",
          days: "",
          lastSale: "",
          bucket: "",
          dead: "",
        },
        withSignature: true,
      };

      // Sheet 3: Dead-stock danh sách riêng
      const deadRows = rows.filter((r) => r.isDeadStock);
      const deadSheet: ExcelSheet = {
        name: "Dead-stock",
        titleRows: [`DEAD-STOCK (${deadRows.length} SP — không bán >60 ngày)`],
        columns: [
          { label: "Mã SP", key: "code", width: 12 },
          { label: "Tên SP", key: "name", width: 30 },
          { label: "Tồn", key: "qty", width: 12, format: "number" },
          { label: "Giá trị vốn chết", key: "value", width: 18, format: "currency" },
          { label: "Tồn ngày", key: "days", width: 12, format: "number" },
          { label: "Không bán bao lâu", key: "noSale", width: 18 },
          { label: "Ngày bán cuối", key: "lastSale", width: 14, format: "text" },
        ],
        rows: deadRows.map((r) => ({
          code: r.code,
          name: r.name,
          qty: r.currentQty,
          value: r.stockValue,
          days: r.daysInStock ?? 0,
          noSale:
            r.daysSinceLastSale !== null
              ? `${r.daysSinceLastSale} ngày`
              : "Chưa từng bán",
          lastSale: r.lastSaleDate ? formatDate(r.lastSaleDate) : "Chưa có",
        })),
        footer: {
          code: "",
          name: "TỔNG GIÁ TRỊ VỐN CHẾT",
          qty: deadRows.reduce((s, r) => s + r.currentQty, 0),
          value: kpis.deadValue,
          days: "",
          noSale: "",
          lastSale: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "hang-hoa",
        mode: "full",
        range: dateRange,
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, overviewSheet, detailSheet, deadSheet],
      });

      toast({
        title: "Đã xuất báo cáo aging",
        description: `4 sheet: Info + Tổng quan + Chi tiết (${rows.length}) + Dead-stock (${deadRows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, bucketAgg, kpis, activeBranchId, toast]);

  // ── Render ──
  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Aging tồn kho / Dead-stock"
        subtitle="Snapshot tồn kho tại thời điểm hiện tại — không filter theo kỳ"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || rows.length === 0}
        hideDateRange
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Tổng giá trị tồn"
          value={formatCurrency(kpis.totalValue) + " đ"}
          icon="inventory_2"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="SL SP đang tồn"
          value={formatNumber(kpis.totalSku)}
          icon="category"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Dead-stock"
          value={`${formatNumber(kpis.deadCount)} SP`}
          change={`${kpis.deadPercent.toFixed(1)}% tổng SKU`}
          positive={kpis.deadPercent < 10}
          icon="warning"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
        <KpiCard
          label="Giá trị vốn chết"
          value={formatCurrency(kpis.deadValue) + " đ"}
          icon="trending_down"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
      </div>

      {/* Chart view */}
      {viewMode === "chart" && (
        <ChartCard
          title="Phân bổ giá trị tồn theo nhóm thời gian"
          subtitle="Dữ liệu thực tế tại thời điểm hiện tại"
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart
                data={bucketAgg}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" fontSize={12} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                />
                <Tooltip
                  formatter={(v: unknown) =>
                    formatCurrency(Number(v) || 0) + " đ"
                  }
                  labelClassName="font-medium"
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {bucketAgg.map((d, i) => (
                    <Cell
                      key={i}
                      fill={BUCKET_COLORS[d.bucketKey] ?? "#9CA3AF"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: `Tất cả (${rows.length})` },
            {
              key: "0-30",
              label: `0–30 ngày (${rows.filter((r) => r.agingBucket === "0-30").length})`,
            },
            {
              key: "31-60",
              label: `31–60 ngày (${rows.filter((r) => r.agingBucket === "31-60").length})`,
            },
            {
              key: "61-90",
              label: `61–90 ngày (${rows.filter((r) => r.agingBucket === "61-90").length})`,
            },
            {
              key: "91+",
              label: `> 90 ngày (${rows.filter((r) => r.agingBucket === "91+").length})`,
            },
            { key: "dead", label: `Dead-stock (${kpis.deadCount})` },
          ] as { key: BucketFilter; label: string }[]
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setBucketFilter(chip.key)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              bucketFilter === chip.key
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
        getRowKey={(r) => r.productId}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có dữ liệu"
              : `SL mặt hàng: ${filteredRows.length}`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="inventory_2" size={40} className="opacity-50 mb-2" />
            <p>Không có sản phẩm trong nhóm này</p>
          </div>
        }
      />
    </div>
  );
}
