"use client";

/**
 * Báo cáo RFM khách hàng (Phase C.3 — CEO 16/05/2026).
 *
 * Phân khúc khách hàng theo 3 trục:
 *   R (Recency)   = ngày kể từ đơn cuối (low = good)
 *   F (Frequency) = số đơn trong kỳ (high = good)
 *   M (Monetary)  = tổng tiền đã chi (high = good)
 *
 * Mỗi trục tính ntile(5) → score 1-5. Tổng RFM tối đa 15.
 *
 * Phân khúc:
 *   - Champion (≥12): VIP, đang tích cực mua
 *   - Loyal (9-11): khách quen, ổn định
 *   - Potential (6-8): có tiềm năng, cần chăm sóc
 *   - At-risk (R≤2, F+M≥6): đã từng chi nhiều nhưng lâu không quay lại
 *   - Lost (còn lại): xa rời
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
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
import { getRfmReport, type RfmRow, type RfmSegment } from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

const SEGMENT_COLORS: Record<RfmSegment, string> = {
  Champion: "#10B981",
  Loyal: "#3B82F6",
  Potential: "#F59E0B",
  "At-risk": "#F97316",
  Lost: "#EF4444",
};

const SEGMENT_LABELS: Record<RfmSegment, string> = {
  Champion: "Champion (VIP)",
  Loyal: "Loyal (Trung thành)",
  Potential: "Potential (Tiềm năng)",
  "At-risk": "At-risk (Sắp mất)",
  Lost: "Lost (Đã mất)",
};

type SegmentFilter = "all" | RfmSegment;

// Score badge với màu — Day 2 audit (CEO 16/05): 1 = đỏ (xấu), 5 = xanh (tốt)
function ScoreBadge({ score }: { score: number }) {
  const color =
    score === 5
      ? "bg-status-success/15 text-status-success"
      : score === 4
        ? "bg-status-success/10 text-status-success"
        : score === 3
          ? "bg-status-warning/10 text-status-warning"
          : score === 2
            ? "bg-status-error/10 text-status-error"
            : "bg-status-error/15 text-status-error";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold tabular-nums",
        color,
      )}
    >
      {score}
    </span>
  );
}

export default function RfmReportPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady } = useBranchFilter();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultViewMode: "chart" });

  const [rows, setRows] = useState<RfmRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("all");

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getRfmReport({
      dateFrom: range.from,
      dateTo: range.to,
      branchId: activeBranchId ?? null,
    })
      .then((res) => setRows(res.rows))
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo RFM",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, range.from, range.to, activeBranchId, toast]);

  const segments = useMemo(() => {
    const counts: Record<string, number> = {
      Champion: 0,
      Loyal: 0,
      Potential: 0,
      "At-risk": 0,
      Lost: 0,
    };
    const values: Record<string, number> = {
      Champion: 0,
      Loyal: 0,
      Potential: 0,
      "At-risk": 0,
      Lost: 0,
    };
    for (const r of rows) {
      counts[r.segment] = (counts[r.segment] ?? 0) + 1;
      values[r.segment] = (values[r.segment] ?? 0) + r.monetary;
    }
    return (Object.keys(counts) as RfmSegment[]).map((s) => ({
      segment: s,
      label: SEGMENT_LABELS[s],
      count: counts[s] ?? 0,
      monetary: values[s] ?? 0,
      color: SEGMENT_COLORS[s],
    }));
  }, [rows]);

  const totalMonetary = rows.reduce((s, r) => s + r.monetary, 0);
  const championCount = segments.find((s) => s.segment === "Champion")?.count ?? 0;
  const loyalCount = segments.find((s) => s.segment === "Loyal")?.count ?? 0;
  const atRiskCount = segments.find((s) => s.segment === "At-risk")?.count ?? 0;
  const lostCount = segments.find((s) => s.segment === "Lost")?.count ?? 0;

  const filteredRows = useMemo(() => {
    if (segmentFilter === "all") return rows;
    return rows.filter((r) => r.segment === segmentFilter);
  }, [rows, segmentFilter]);

  const columns: DataTableColumn<RfmRow>[] = [
    { label: "Khách hàng", key: "name", width: "200px" },
    {
      label: "SĐT",
      key: "phone",
      width: "120px",
      cell: (r) => r.phone ?? "—",
    },
    {
      label: "R",
      key: "rScore",
      align: "center",
      cell: (r) => <ScoreBadge score={r.rScore} />,
    },
    {
      label: "F",
      key: "fScore",
      align: "center",
      cell: (r) => <ScoreBadge score={r.fScore} />,
    },
    {
      label: "M",
      key: "mScore",
      align: "center",
      cell: (r) => <ScoreBadge score={r.mScore} />,
    },
    {
      label: "Số đơn",
      key: "frequency",
      align: "right",
      cell: (r) => formatNumber(r.frequency),
    },
    {
      label: "Tổng tiền",
      key: "monetary",
      align: "right",
      cell: (r) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(r.monetary)}
        </span>
      ),
    },
    {
      label: "Đơn cuối",
      key: "lastOrderAt",
      align: "center",
      cell: (r) => (r.lastOrderAt ? formatDate(r.lastOrderAt) : "—"),
    },
    {
      label: "Cách hôm nay",
      key: "recencyDays",
      align: "right",
      cell: (r) => `${r.recencyDays}d`,
    },
    {
      label: "Phân khúc",
      key: "segment",
      cell: (r) => (
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
          style={{ background: SEGMENT_COLORS[r.segment] }}
        >
          {r.segment}
        </span>
      ),
    },
  ];

  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO RFM KHÁCH HÀNG",
        description:
          "Phân khúc khách hàng theo Recency × Frequency × Monetary — CMO target campaign",
        range,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Mỗi trục R/F/M tính ntile(5). Phân khúc: Champion (≥12), Loyal (9-11), Potential (6-8), At-risk, Lost.",
      });

      const segmentSheet: ExcelSheet = {
        name: "Phân khúc",
        titleRows: ["TỔNG QUAN PHÂN KHÚC RFM"],
        columns: [
          { label: "Phân khúc", key: "label", width: 28 },
          { label: "Số KH", key: "count", width: 12, format: "number" },
          { label: "Tổng chi tiêu", key: "value", width: 18, format: "currency" },
        ],
        rows: segments.map((s) => ({
          label: s.label,
          count: s.count,
          value: s.monetary,
        })),
        footer: {
          label: "TỔNG",
          count: rows.length,
          value: totalMonetary,
        },
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết",
        titleRows: ["CHI TIẾT TỪNG KHÁCH HÀNG"],
        columns: [
          { label: "Mã KH", key: "code", width: 12 },
          { label: "Khách hàng", key: "name", width: 24 },
          { label: "SĐT", key: "phone", width: 14 },
          { label: "R", key: "r", width: 6, format: "number" },
          { label: "F", key: "f", width: 6, format: "number" },
          { label: "M", key: "m", width: 6, format: "number" },
          { label: "Số đơn", key: "freq", width: 10, format: "number" },
          { label: "Tổng tiền", key: "money", width: 16, format: "currency" },
          { label: "Đơn cuối", key: "last", width: 14, format: "text" },
          { label: "Cách (ngày)", key: "days", width: 12, format: "number" },
          { label: "Phân khúc", key: "segment", width: 14 },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          name: r.name,
          phone: r.phone ?? "",
          r: r.rScore,
          f: r.fScore,
          m: r.mScore,
          freq: r.frequency,
          money: r.monetary,
          last: r.lastOrderAt ? formatDate(r.lastOrderAt) : "",
          days: r.recencyDays,
          segment: r.segment,
        })),
        footer: {
          code: "",
          name: `${rows.length} KH`,
          phone: "",
          r: "",
          f: "",
          m: "",
          freq: rows.reduce((s, r) => s + r.frequency, 0),
          money: totalMonetary,
          last: "",
          days: "",
          segment: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "khach-hang",
        mode: "full",
        range,
        tenantName: "OneBiz",
        sheets: [infoSheet, segmentSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo RFM",
        description: `3 sheet: Info + Phân khúc + Chi tiết (${rows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, segments, totalMonetary, range, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="RFM khách hàng"
        subtitle="Phân khúc khách hàng — Champion / Loyal / Potential / At-risk / Lost"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || rows.length === 0}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Tổng KH"
          value={formatNumber(rows.length)}
          icon="group"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Champion (VIP)"
          value={formatNumber(championCount)}
          change={`${rows.length > 0 ? ((championCount / rows.length) * 100).toFixed(1) : 0}%`}
          positive
          icon="emoji_events"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="Loyal (trung thành)"
          value={formatNumber(loyalCount)}
          change={`${rows.length > 0 ? ((loyalCount / rows.length) * 100).toFixed(1) : 0}%`}
          positive
          icon="favorite"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard
          label="At-risk (cần chăm)"
          value={formatNumber(atRiskCount)}
          change="Lâu không quay lại"
          positive={false}
          icon="warning"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label="Lost (đã mất)"
          value={formatNumber(lostCount)}
          icon="person_off"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
      </div>

      {viewMode === "chart" && rows.length > 0 && (
        <ChartCard
          title="Phân bổ khách hàng theo phân khúc RFM"
          subtitle="Tỷ trọng từng phân khúc"
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={segments.filter((s) => s.count > 0)}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={(props) => {
                    const lbl = (props as { label?: string }).label ?? "";
                    const val = Number((props as { count?: number }).count ?? 0);
                    return `${lbl}: ${val}`;
                  }}
                >
                  {segments
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <Cell key={s.segment} fill={s.color} />
                    ))}
                </Pie>
                <Tooltip
                  formatter={(v: unknown) => `${formatNumber(Number(v) || 0)} KH`}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSegmentFilter("all")}
          className={cn(
            "h-8 px-3 rounded-full text-xs font-medium transition-colors",
            segmentFilter === "all"
              ? "bg-primary text-on-primary"
              : "bg-surface-container-low text-foreground hover:bg-surface-container",
          )}
        >
          Tất cả ({rows.length})
        </button>
        {segments.map((s) => (
          <button
            key={s.segment}
            type="button"
            onClick={() => setSegmentFilter(s.segment)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              segmentFilter === s.segment
                ? "text-white"
                : "bg-surface-container-low text-foreground hover:bg-surface-container",
            )}
            style={
              segmentFilter === s.segment ? { background: s.color } : undefined
            }
          >
            {s.label} ({s.count})
          </button>
        ))}
      </div>

      <ReportDataTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(r) => r.customerId}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có khách hàng"
              : `${filteredRows.length} KH — Tổng chi tiêu: ${formatCurrency(filteredRows.reduce((s, r) => s + r.monetary, 0))}đ`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="person" size={40} className="opacity-50 mb-2" />
            <p>Không có khách hàng trong phân khúc này</p>
          </div>
        }
      />
    </div>
  );
}
