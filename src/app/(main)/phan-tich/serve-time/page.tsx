"use client";

/**
 * Báo cáo Time-to-serve FnB (Phase C.4 — CEO 16/05/2026).
 *
 * Đo thời gian từ khi tạo đơn bếp → khi món cuối cùng ready.
 * COO dùng để:
 *   - Biết thời gian phục vụ TB của chuỗi (KPI ngành cà phê ~5-10 phút)
 *   - So sánh giữa các chi nhánh — chi nhánh nào chậm cần training
 *   - Xem giờ peak (avg cao bất thường) → bố trí thêm pha chế
 *   - Median + p90 để bỏ outliers (đơn cá biệt)
 */

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber } from "@/lib/format";
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
  getFnbServeTimeReport,
  type FnbServeTimeReport,
  type ServeTimeByBranch,
  type ServeTimeByHour,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

function fmtMin(m: number): string {
  return `${m.toFixed(1)} phút`;
}

export default function FnbServeTimeReportPage() {
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

  const [report, setReport] = useState<FnbServeTimeReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getFnbServeTimeReport({
      branchId: activeBranchId ?? null,
      dateFrom: range.from,
      dateTo: range.to,
    })
      .then(setReport)
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo serve time",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, range.from, range.to, toast]);

  const summary = report?.summary ?? {
    orderCount: 0,
    avgMinutes: 0,
    minMinutes: 0,
    maxMinutes: 0,
    medianMinutes: 0,
    p90Minutes: 0,
  };
  const byBranch = report?.byBranch ?? [];
  const byHour = report?.byHour ?? [];
  const byProduct = report?.byProduct ?? [];

  const branchColumns: DataTableColumn<ServeTimeByBranch>[] = [
    { label: "Chi nhánh", key: "branchName", width: "200px" },
    {
      label: "Số đơn",
      key: "orderCount",
      align: "right",
      cell: (r) => formatNumber(r.orderCount),
    },
    {
      label: "TB",
      key: "avgMinutes",
      align: "right",
      cell: (r) => (
        <span
          className={`font-semibold tabular-nums ${
            r.avgMinutes > 10
              ? "text-status-error"
              : r.avgMinutes > 7
                ? "text-status-warning"
                : "text-status-success"
          }`}
        >
          {fmtMin(r.avgMinutes)}
        </span>
      ),
    },
    {
      label: "Trung vị",
      key: "medianMinutes",
      align: "right",
      cell: (r) => fmtMin(r.medianMinutes),
    },
    {
      label: "P90 (90%)",
      key: "p90Minutes",
      align: "right",
      cell: (r) => fmtMin(r.p90Minutes),
    },
  ];

  const hourColumns: DataTableColumn<ServeTimeByHour>[] = [
    {
      label: "Giờ",
      key: "hourOfDay",
      width: "100px",
      cell: (r) => `${r.hourOfDay}:00 – ${r.hourOfDay}:59`,
    },
    {
      label: "Số đơn",
      key: "orderCount",
      align: "right",
      cell: (r) => formatNumber(r.orderCount),
    },
    {
      label: "TB",
      key: "avgMinutes",
      align: "right",
      cell: (r) => fmtMin(r.avgMinutes),
    },
  ];

  const handleExport = useCallback(() => {
    if (!report) return;
    try {
      const branchLabel = activeBranchId ? "Chi nhánh đang chọn" : "Tất cả chi nhánh";
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO TIME-TO-SERVE FnB",
        description:
          "Thời gian từ tạo đơn bếp → ready (max kitchen_order_items.completed_at)",
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "KPI ngành cà phê: <7 phút TB là tốt, 7-10 phút bình thường, >10 phút cần cải thiện.",
      });

      const summarySheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: ["TỔNG QUAN TIME-TO-SERVE"],
        columns: [
          { label: "Chỉ tiêu", key: "label", width: 28 },
          { label: "Giá trị", key: "value", width: 18 },
        ],
        rows: [
          { label: "Số đơn đã đo", value: formatNumber(summary.orderCount) },
          { label: "Trung bình", value: fmtMin(summary.avgMinutes) },
          { label: "Trung vị (median)", value: fmtMin(summary.medianMinutes) },
          { label: "Nhanh nhất", value: fmtMin(summary.minMinutes) },
          { label: "Chậm nhất", value: fmtMin(summary.maxMinutes) },
          { label: "P90 (90% đơn dưới)", value: fmtMin(summary.p90Minutes) },
        ],
      };

      const branchSheet: ExcelSheet = {
        name: "Theo chi nhánh",
        titleRows: ["TIME-TO-SERVE THEO CHI NHÁNH"],
        columns: [
          { label: "Chi nhánh", key: "name", width: 24 },
          { label: "Số đơn", key: "count", width: 12, format: "number" },
          { label: "TB (phút)", key: "avg", width: 12, format: "number" },
          { label: "Median (phút)", key: "median", width: 14, format: "number" },
          { label: "P90 (phút)", key: "p90", width: 12, format: "number" },
        ],
        rows: byBranch.map((b) => ({
          name: b.branchName ?? "Không xác định",
          count: b.orderCount,
          avg: b.avgMinutes,
          median: b.medianMinutes,
          p90: b.p90Minutes,
        })),
      };

      const hourSheet: ExcelSheet = {
        name: "Theo giờ",
        titleRows: ["TIME-TO-SERVE THEO GIỜ TRONG NGÀY"],
        columns: [
          { label: "Giờ", key: "hour", width: 14 },
          { label: "Số đơn", key: "count", width: 12, format: "number" },
          { label: "TB (phút)", key: "avg", width: 12, format: "number" },
        ],
        rows: byHour.map((h) => ({
          hour: `${h.hourOfDay}:00`,
          count: h.orderCount,
          avg: h.avgMinutes,
        })),
        withSignature: true,
      };

      exportReportToExcel({
        kind: "fnb",
        mode: "full",
        range,
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, summarySheet, branchSheet, hourSheet],
      });

      toast({
        title: "Đã xuất báo cáo serve time",
        description: `4 sheet: Info + Tổng quan + Chi nhánh (${byBranch.length}) + Theo giờ (${byHour.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [report, summary, byBranch, byHour, range, activeBranchId, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Time-to-serve FnB"
        subtitle="Thời gian phục vụ TB — tối ưu nhân sự giờ peak"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || !report}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="TB phục vụ"
          value={fmtMin(summary.avgMinutes)}
          change={`${formatNumber(summary.orderCount)} đơn`}
          positive={summary.avgMinutes <= 7}
          icon="schedule"
          bg={
            summary.avgMinutes > 10
              ? "bg-status-error/10"
              : summary.avgMinutes > 7
                ? "bg-status-warning/10"
                : "bg-status-success/10"
          }
          iconColor={
            summary.avgMinutes > 10
              ? "text-status-error"
              : summary.avgMinutes > 7
                ? "text-status-warning"
                : "text-status-success"
          }
          valueColor={
            summary.avgMinutes > 10
              ? "text-status-error"
              : summary.avgMinutes > 7
                ? "text-status-warning"
                : "text-status-success"
          }
        />
        <KpiCard
          label="Trung vị"
          value={fmtMin(summary.medianMinutes)}
          icon="timeline"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="P90 (90% đơn ≤)"
          value={fmtMin(summary.p90Minutes)}
          icon="speed"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Chậm nhất"
          value={fmtMin(summary.maxMinutes)}
          icon="hourglass_top"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
      </div>

      {viewMode === "chart" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="TB phục vụ theo chi nhánh"
            subtitle="Đỏ = chậm (>10p), Vàng = bình thường (7-10p), Xanh = nhanh (<7p)"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byBranch}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="branchName" fontSize={11} />
                  <YAxis fontSize={11} unit="p" />
                  <Tooltip
                    formatter={(v: unknown) => fmtMin(Number(v) || 0)}
                  />
                  <Bar dataKey="avgMinutes" radius={[6, 6, 0, 0]}>
                    {byBranch.map((b, i) => (
                      <Cell
                        key={i}
                        fill={
                          b.avgMinutes > 10
                            ? "#EF4444"
                            : b.avgMinutes > 7
                              ? "#F59E0B"
                              : "#10B981"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            title="TB phục vụ theo giờ trong ngày"
            subtitle="Giờ nào chậm = bố trí thêm pha chế"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart
                  data={byHour}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="hourOfDay"
                    fontSize={11}
                    tickFormatter={(v) => `${v}h`}
                  />
                  <YAxis fontSize={11} unit="p" />
                  <Tooltip
                    formatter={(v: unknown) => fmtMin(Number(v) || 0)}
                    labelFormatter={(l) => `${l}:00 – ${l}:59`}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgMinutes"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {/* Day 3 16/05: Top 10 món pha lâu nhất — COO tối ưu công thức */}
      {viewMode === "chart" && byProduct.length > 0 && (
        <ChartCard
          title="Top 10 món pha lâu nhất (TB phút/món)"
          subtitle="Món >5p cần xem lại công thức hoặc bố trí dụng cụ"
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart
                data={byProduct.slice(0, 10)}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 120, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} unit="p" />
                <YAxis
                  type="category"
                  dataKey="productName"
                  fontSize={10}
                  width={120}
                />
                <Tooltip formatter={(v: unknown) => fmtMin(Number(v) || 0)} />
                <Bar dataKey="avgMinutes" radius={[0, 4, 4, 0]}>
                  {byProduct.slice(0, 10).map((p, i) => (
                    <Cell
                      key={i}
                      fill={
                        p.avgMinutes > 10
                          ? "#EF4444"
                          : p.avgMinutes > 5
                            ? "#F59E0B"
                            : "#10B981"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportDataTable
          columns={branchColumns}
          rows={byBranch}
          getRowKey={(r) => r.branchId ?? "unknown"}
          subtotalLabel={
            loading
              ? "Đang tải..."
              : byBranch.length === 0
                ? "Không có dữ liệu"
                : `${byBranch.length} chi nhánh`
          }
          emptyState={
            <div className="text-center py-8 text-muted-foreground">
              <Icon name="store" size={32} className="opacity-50 mb-2" />
              <p>Không có dữ liệu chi nhánh</p>
            </div>
          }
        />
        <ReportDataTable
          columns={hourColumns}
          rows={byHour}
          getRowKey={(r) => r.hourOfDay}
          subtotalLabel={
            loading
              ? "Đang tải..."
              : byHour.length === 0
                ? "Không có dữ liệu"
                : `${byHour.length} khung giờ có đơn`
          }
          emptyState={
            <div className="text-center py-8 text-muted-foreground">
              <Icon name="schedule" size={32} className="opacity-50 mb-2" />
              <p>Không có dữ liệu giờ</p>
            </div>
          }
        />
      </div>
    </div>
  );
}
