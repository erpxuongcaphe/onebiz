"use client";

/**
 * Customer Cohort Retention — REP-3 (CEO 06/05/2026).
 *
 * Matrix retention KH theo cohort tháng đầu mua. Mỗi cell là %
 * KH cohort quay lại trong tháng N sau đó.
 */

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import {
  ReportPageHeader,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";
import { getCustomerCohortReport } from "@/lib/services/supabase/customer-cohort";
import type { CohortReportResult } from "@/lib/services/supabase/customer-cohort";
import { cn } from "@/lib/utils";
import { KpiCard } from "../_components";

export default function CustomerCohortPage() {
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisYear", defaultViewMode: "table" });

  const [data, setData] = useState<CohortReportResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCustomerCohortReport(6);
      setData(result);
    } catch (err) {
      console.error("Failed to fetch cohort report:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalCohorts = data?.rows.length ?? 0;
  const totalCustomers = data?.rows.reduce((s, r) => s + r.size, 0) ?? 0;
  // Avg M1 retention across cohorts (skip cohorts với <2 tháng data)
  const m1Retention = (() => {
    if (!data) return 0;
    const valid = data.rows.filter((r) => r.retention.length >= 2);
    if (valid.length === 0) return 0;
    return Math.round(
      valid.reduce((s, r) => s + r.retention[1], 0) / valid.length,
    );
  })();

  const handleExportView = useCallback(() => {
    if (!data) return;
    const titleRows = buildReportTitleRows({
      title: "Báo cáo cohort retention",
      range,
      generatedAt: new Date(),
    });

    // Build columns: Cohort | Size | M0 | M1 | M2 | M3 | M4 | M5
    const cols = [
      { label: "Cohort", key: "label", width: 14 },
      { label: "Size", key: "size", width: 10, format: "number" as const },
    ];
    for (let i = 0; i < data.monthsTracked; i++) {
      cols.push({
        label: `M${i}`,
        key: `m${i}`,
        width: 10,
        format: "number" as const,
      });
    }

    exportReportToExcel({
      kind: "khach-hang",
      mode: "view",
      range,
      sheets: [
        {
          name: "Cohort retention",
          titleRows,
          columns: cols,
          rows: data.rows.map((r) => {
            const row: Record<string, unknown> = {
              label: r.label,
              size: r.size,
            };
            for (let i = 0; i < data.monthsTracked; i++) {
              row[`m${i}`] = r.retention[i] ?? null;
            }
            return row;
          }),
        },
      ],
    });
  }, [data, range]);

  const colorForRetention = (pct: number): string => {
    if (pct === 0) return "bg-surface-container/30 text-muted-foreground";
    if (pct < 10) return "bg-status-error/10 text-status-error";
    if (pct < 30) return "bg-status-warning/15 text-status-warning";
    if (pct < 50) return "bg-status-info/15 text-status-info";
    return "bg-status-success/20 text-status-success font-bold";
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <ReportPageHeader
        title="Khách hàng quay lại theo tháng đầu mua"
        subtitle="Tỷ lệ khách hàng quay lại trong các tháng kế tiếp sau lần mua đầu tiên"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        exportDisabled={loading || !data}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            label="Số nhóm khách"
            value={String(totalCohorts)}
            change={`${data?.monthsTracked ?? 6} tháng theo dõi`}
            positive
            icon="group"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tổng khách hàng lần đầu"
            value={String(totalCustomers)}
            change="6 tháng gần nhất"
            positive
            icon="person_add"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tháng kế tiếp quay lại trung bình"
            value={`${m1Retention}%`}
            change={
              m1Retention >= 30
                ? "Tốt"
                : m1Retention >= 20
                  ? "Trung bình"
                  : "Cần cải thiện"
            }
            positive={m1Retention >= 30}
            icon="repeat"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
        </div>

        {/* Cohort matrix */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Đang tính toán cohort...
            </p>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Chưa có dữ liệu cohort
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-primary-fixed/40 border-b border-border">
                  <th className="px-3 py-2 text-xs font-semibold text-left">
                    Nhóm tháng đầu mua
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-right">
                    Số khách
                  </th>
                  {Array.from({ length: data.monthsTracked }).map((_, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 text-xs font-semibold text-center min-w-[80px]"
                    >
                      {i === 0 ? "Tháng đầu" : `Tháng +${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.cohortMonth}
                    className="border-b border-border/50"
                  >
                    <td className="px-3 py-2 text-xs font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">
                      {r.size}
                    </td>
                    {Array.from({ length: data.monthsTracked }).map((_, i) => {
                      const pct = r.retention[i];
                      if (pct == null)
                        return <td key={i} className="px-3 py-2"></td>;
                      return (
                        <td
                          key={i}
                          className={cn(
                            "px-3 py-2 text-xs text-center tabular-nums",
                            colorForRetention(pct),
                          )}
                        >
                          {pct.toFixed(0)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <span>Màu:</span>
          <span className="bg-status-error/10 text-status-error px-2 py-0.5 rounded">
            &lt; 10%
          </span>
          <span className="bg-status-warning/15 text-status-warning px-2 py-0.5 rounded">
            10-30%
          </span>
          <span className="bg-status-info/15 text-status-info px-2 py-0.5 rounded">
            30-50%
          </span>
          <span className="bg-status-success/20 text-status-success px-2 py-0.5 rounded font-bold">
            ≥ 50%
          </span>
        </div>
      </div>
    </div>
  );
}
