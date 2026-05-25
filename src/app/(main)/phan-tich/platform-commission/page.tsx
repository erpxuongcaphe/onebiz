"use client";

/**
 * Báo cáo Net delivery commission (Phase B.3 — CEO 16/05/2026).
 *
 * Phân tích phí từng platform giao hàng (Grab/Shopee/Now/Gojek/Be) — tách
 * doanh thu gross, commission, net để biết:
 *
 *   - Platform nào "lấy" nhiều nhất % doanh thu?
 *   - Tổng phí phải trả cho platform tháng này là bao nhiêu?
 *   - So sánh giữa các chi nhánh — chi nhánh nào bán delivery nhiều?
 *   - Net revenue thật khi sale qua delivery vs bán trực tiếp tại quán
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
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency } from "@/lib/format";
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
  getPlatformCommissionReport,
  type PlatformCommissionRow,
  type PlatformCommissionSummary,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

const PLATFORM_LABEL: Record<string, string> = {
  direct: "Trực tiếp / Tự giao",
  shopee_food: "Shopee Food",
  grab_food: "Grab Food",
  gojek: "Gojek",
  be: "Be",
  other: "Khác",
};

const PLATFORM_COLORS: Record<string, string> = {
  direct: "#10B981",
  shopee_food: "#F97316",
  grab_food: "#22C55E",
  gojek: "#0EA5E9",
  be: "#FBBF24",
  other: "#9CA3AF",
};

export default function PlatformCommissionReportPage() {
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

  const [rows, setRows] = useState<PlatformCommissionRow[]>([]);
  const [summary, setSummary] = useState<PlatformCommissionSummary>({
    totalOrders: 0,
    totalGross: 0,
    totalCommission: 0,
    totalNet: 0,
    totalLostToPlatform: 0,
  });
  const [previousPeriod, setPreviousPeriod] = useState<{
    totalOrders: number;
    totalGross: number;
    totalCommission: number;
    totalNet: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getPlatformCommissionReport({
      branchId: activeBranchId ?? null,
      dateFrom: range.from,
      dateTo: range.to,
    })
      .then((res) => {
        setRows(res.rows);
        setSummary(res.summary);
        setPreviousPeriod(res.previousPeriod ?? null);
      })
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo platform",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, range.from, range.to, toast]);

  // ── Aggregations ──
  const byPlatform = useMemo(() => {
    const map = new Map<
      string,
      { orders: number; gross: number; commission: number; net: number }
    >();
    for (const r of rows) {
      const ex = map.get(r.platform) ?? {
        orders: 0,
        gross: 0,
        commission: 0,
        net: 0,
      };
      ex.orders += r.orderCount;
      ex.gross += r.grossRevenue;
      ex.commission += r.commissionTotal;
      ex.net += r.netRevenue;
      map.set(r.platform, ex);
    }
    return Array.from(map.entries())
      .map(([platform, d]) => ({
        platform,
        label: PLATFORM_LABEL[platform] ?? platform,
        ...d,
        effectivePercent: d.gross > 0 ? (d.commission / d.gross) * 100 : 0,
      }))
      .sort((a, b) => b.gross - a.gross);
  }, [rows]);

  const effectiveCommissionPercent =
    summary.totalGross > 0
      ? (summary.totalCommission / summary.totalGross) * 100
      : 0;

  // ── Columns ──
  const columns: DataTableColumn<PlatformCommissionRow>[] = [
    {
      label: "Platform",
      key: "platform",
      width: "160px",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: PLATFORM_COLORS[r.platform] ?? "#9CA3AF" }}
          />
          {PLATFORM_LABEL[r.platform] ?? r.platform}
        </span>
      ),
    },
    { label: "Chi nhánh", key: "branchName", width: "160px" },
    {
      label: "Số đơn",
      key: "orderCount",
      align: "right",
      cell: (r) => formatNumber(r.orderCount),
    },
    {
      label: "Doanh thu Gross",
      key: "grossRevenue",
      align: "right",
      cell: (r) => formatCurrency(r.grossRevenue),
    },
    {
      label: "Commission",
      key: "commissionTotal",
      align: "right",
      cell: (r) => (
        <span className="text-status-error tabular-nums">
          {formatCurrency(r.commissionTotal)}
        </span>
      ),
    },
    {
      label: "% Phí",
      key: "effectiveCommissionPercent",
      align: "right",
      cell: (r) => `${r.effectiveCommissionPercent.toFixed(1)}%`,
    },
    {
      label: "Net (thực thu)",
      key: "netRevenue",
      align: "right",
      cell: (r) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatCurrency(r.netRevenue)}
        </span>
      ),
    },
    {
      label: "AOV",
      key: "avgOrderValue",
      align: "right",
      cell: (r) => formatCurrency(r.avgOrderValue),
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
        title: "BÁO CÁO PHÍ DELIVERY PLATFORM",
        description:
          "Gross vs Commission vs Net theo từng platform × chi nhánh — đo lường chi phí thật của bán qua app",
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Chỉ tính đơn FnB completed. Direct = đơn quán tự giao / khách đến quán. Commission lấy từ invoices.platform_commission (migration 00070).",
      });

      const summarySheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: ["TỔNG QUAN PHÍ PLATFORM"],
        columns: [
          { label: "Chỉ tiêu", key: "label", width: 30 },
          { label: "Giá trị", key: "value", width: 22 },
        ],
        rows: [
          { label: "Tổng số đơn delivery", value: formatNumber(summary.totalOrders) },
          { label: "Doanh thu Gross", value: formatCurrency(summary.totalGross) + " đ" },
          { label: "Tổng commission trả platform", value: formatCurrency(summary.totalCommission) + " đ" },
          { label: "Doanh thu Net thực thu", value: formatCurrency(summary.totalNet) + " đ" },
          { label: "% Phí trung bình", value: `${effectiveCommissionPercent.toFixed(2)}%` },
        ],
      };

      const platformSheet: ExcelSheet = {
        name: "Theo platform",
        titleRows: ["PHÍ THEO TỪNG PLATFORM"],
        columns: [
          { label: "Platform", key: "label", width: 22 },
          { label: "Số đơn", key: "orders", width: 12, format: "number" },
          { label: "Gross", key: "gross", width: 18, format: "currency" },
          { label: "Commission", key: "commission", width: 18, format: "currency" },
          { label: "Net", key: "net", width: 18, format: "currency" },
          { label: "% Phí", key: "pct", width: 12 },
        ],
        rows: byPlatform.map((p) => ({
          label: p.label,
          orders: p.orders,
          gross: p.gross,
          commission: p.commission,
          net: p.net,
          pct: `${p.effectivePercent.toFixed(2)}%`,
        })),
        footer: {
          label: "TỔNG",
          orders: summary.totalOrders,
          gross: summary.totalGross,
          commission: summary.totalCommission,
          net: summary.totalNet,
          pct: `${effectiveCommissionPercent.toFixed(2)}%`,
        },
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết platform × CN",
        titleRows: ["CHI TIẾT PLATFORM × CHI NHÁNH"],
        columns: [
          { label: "Platform", key: "platform", width: 20 },
          { label: "Chi nhánh", key: "branch", width: 24 },
          { label: "Số đơn", key: "orders", width: 12, format: "number" },
          { label: "Gross", key: "gross", width: 16, format: "currency" },
          { label: "Commission", key: "commission", width: 16, format: "currency" },
          { label: "Net", key: "net", width: 16, format: "currency" },
          { label: "% Phí", key: "pct", width: 10 },
          { label: "AOV", key: "aov", width: 14, format: "currency" },
        ],
        rows: rows.map((r) => ({
          platform: PLATFORM_LABEL[r.platform] ?? r.platform,
          branch: r.branchName ?? "",
          orders: r.orderCount,
          gross: r.grossRevenue,
          commission: r.commissionTotal,
          net: r.netRevenue,
          pct: `${r.effectiveCommissionPercent.toFixed(2)}%`,
          aov: r.avgOrderValue,
        })),
        footer: {
          platform: "",
          branch: "TỔNG",
          orders: summary.totalOrders,
          gross: summary.totalGross,
          commission: summary.totalCommission,
          net: summary.totalNet,
          pct: `${effectiveCommissionPercent.toFixed(2)}%`,
          aov: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "kenh-ban",
        mode: "full",
        range,
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, summarySheet, platformSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo phí platform",
        description: `4 sheet: Info + Tổng quan + Theo platform (${byPlatform.length}) + Chi tiết (${rows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, byPlatform, summary, effectiveCommissionPercent, range, activeBranchId, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Phí platform delivery"
        subtitle="Gross vs Commission vs Net theo Grab / Shopee / Gojek / Be"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || rows.length === 0}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Doanh thu Gross"
          value={formatCurrency(summary.totalGross) + " đ"}
          change={
            previousPeriod && previousPeriod.totalGross > 0
              ? `${summary.totalGross > previousPeriod.totalGross ? "+" : ""}${(((summary.totalGross - previousPeriod.totalGross) / previousPeriod.totalGross) * 100).toFixed(1)}% so kỳ trước`
              : `${formatNumber(summary.totalOrders)} đơn`
          }
          positive={
            !previousPeriod ||
            summary.totalGross >= previousPeriod.totalGross
          }
          icon="payments"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Commission trả platform"
          value={formatCurrency(summary.totalCommission) + " đ"}
          change={
            previousPeriod && previousPeriod.totalCommission > 0
              ? `${summary.totalCommission > previousPeriod.totalCommission ? "+" : ""}${(((summary.totalCommission - previousPeriod.totalCommission) / previousPeriod.totalCommission) * 100).toFixed(1)}% so kỳ trước`
              : `${effectiveCommissionPercent.toFixed(1)}% gross`
          }
          positive={
            !previousPeriod ||
            summary.totalCommission <= previousPeriod.totalCommission
          }
          icon="trending_down"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
        <KpiCard
          label="Net thực thu"
          value={formatCurrency(summary.totalNet) + " đ"}
          change={
            previousPeriod && previousPeriod.totalNet > 0
              ? `${summary.totalNet > previousPeriod.totalNet ? "+" : ""}${(((summary.totalNet - previousPeriod.totalNet) / previousPeriod.totalNet) * 100).toFixed(1)}% so kỳ trước`
              : undefined
          }
          positive={
            !previousPeriod || summary.totalNet >= previousPeriod.totalNet
          }
          icon="account_balance"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="Mất do platform"
          value={formatCurrency(summary.totalLostToPlatform) + " đ"}
          change="Gross − Net (sau phí)"
          positive={false}
          icon="warning"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
      </div>

      {viewMode === "chart" && byPlatform.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Doanh thu Gross / Commission / Net theo platform"
            subtitle="So sánh chi phí thật"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byPlatform}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis
                    fontSize={11}
                    tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                  />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [
                      formatCurrency(Number(v) || 0) + " đ",
                      String(name),
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="gross" name="Gross" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="commission" name="Commission" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="net" name="Net" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            title="Tỷ trọng đơn theo platform"
            subtitle="Phân bổ số đơn delivery"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={byPlatform}
                    dataKey="orders"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(props) => {
                      const lbl = (props as { label?: string }).label ?? "";
                      const val = Number((props as { orders?: number }).orders ?? 0);
                      return `${lbl}: ${val}`;
                    }}
                  >
                    {byPlatform.map((p) => (
                      <Cell
                        key={p.platform}
                        fill={PLATFORM_COLORS[p.platform] ?? "#9CA3AF"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: unknown) => formatNumber(Number(v) || 0) + " đơn"}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      <ReportDataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => `${r.platform}-${r.branchId ?? ""}`}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : rows.length === 0
              ? "Không có dữ liệu delivery trong kỳ"
              : `${rows.length} dòng — Tổng commission: ${formatCurrency(summary.totalCommission)}đ (${effectiveCommissionPercent.toFixed(1)}%)`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="delivery_dining" size={40} className="opacity-50 mb-2" />
            <p>Chưa có đơn delivery nào trong kỳ</p>
          </div>
        }
      />
    </div>
  );
}
