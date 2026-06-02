"use client";

/**
 * Báo cáo Tuỳ chọn món FnB (CEO 01/06/2026 — Bước 2 Sprint 2.5)
 *
 * Đo lường:
 *   - Bao nhiêu ly "70% đường" / "Không đá" bán ra trong kỳ
 *   - Topping nào bán chạy nhất + doanh thu phí cộng
 *   - % chia trong từng nhóm (Mức đường: 70% chiếm 45%, 100% chiếm 30%...)
 *
 * Dùng cho:
 *   - Anh quyết định bỏ option nào (vd "không đường" 1% → cân nhắc bỏ).
 *   - Setup giá topping (vd Trân châu chiếm 60% → có thể tăng phí).
 */

import { useEffect, useState, useCallback } from "react";
import { KpiCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getModifierStats } from "@/lib/services/supabase/fnb-analytics";
import type { ModifierStatRow } from "@/lib/services/supabase/fnb-analytics";
import { exportReportToExcel, buildReportTitleRows } from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export default function FnbModifierReportPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultPreset: "thisMonth",
    defaultViewMode: "table",
  });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ModifierStatRow[]>([]);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getModifierStats(activeBranchId, range);
      setStats(list);
    } catch (err) {
      console.error("Failed to fetch modifier stats:", err);
      toast({
        title: "Lỗi tải báo cáo",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId, range, toast]);

  useEffect(() => {
    if (!isReady) return;
    void fetchData();
  }, [fetchData, isReady]);

  // Group rows theo groupId để render thành section
  const grouped = stats.reduce<Record<string, ModifierStatRow[]>>((acc, row) => {
    const key = row.groupId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
  const groupIds = Object.keys(grouped);

  const totalPicks = stats.reduce((s, r) => s + r.count, 0);
  const totalRevenue = stats.reduce((s, r) => s + r.totalPriceDelta, 0);
  const activeGroups = groupIds.length;

  const handleExport = () => {
    const titleRows = buildReportTitleRows({
      title: "Báo cáo Tuỳ chọn món FnB",
      branchName: branchLabel,
      range,
    });
    exportReportToExcel({
      kind: "fnb",
      mode: "view",
      range,
      branchName: branchLabel,
      sheets: [
        {
          name: "Tuỳ chọn",
          titleRows,
          columns: [
            { label: "Nhóm", key: "groupName", width: 24 },
            { label: "Option", key: "optionLabel", width: 24 },
            { label: "Lượt chọn", key: "count", width: 14, format: "number" },
            { label: "% trong nhóm", key: "percentInGroup", width: 16 },
            { label: "Tổng SL", key: "totalQuantity", width: 14, format: "number" },
            { label: "Phí cộng (đ)", key: "totalPriceDelta", width: 18, format: "currency" },
          ],
          rows: stats.map((s) => ({
            groupName: s.groupName,
            optionLabel: s.optionLabel,
            count: s.count,
            percentInGroup: `${s.percentInGroup ?? 0}%`,
            totalQuantity: s.totalQuantity,
            totalPriceDelta: s.totalPriceDelta,
          })),
        },
      ],
    });
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ReportPageHeader
        title="Tuỳ chọn món FnB"
        subtitle="Phân tích lựa chọn Mức đường, Mức đá, Topping... của khách trong kỳ."
        preset={preset}
        onPresetChange={setPreset}
        range={range}
        onCustomRangeChange={setCustomRange}
        onExportView={stats.length > 0 ? handleExport : undefined}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard
          label="Tổng lượt chọn"
          value={formatNumber(totalPicks)}
          icon="tune"
          bg="bg-primary/10"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Doanh thu phí cộng"
          value={formatCurrency(totalRevenue) + "đ"}
          icon="payments"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Nhóm tuỳ chọn hoạt động"
          value={formatNumber(activeGroups)}
          icon="category"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
      </div>

      {loading ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <Icon name="progress_activity" size={20} className="mr-2 inline animate-spin" />
          Đang tải...
        </div>
      ) : stats.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed p-10 text-center">
          <Icon name="insights" size={36} className="mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm font-medium">Chưa có dữ liệu tuỳ chọn</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Báo cáo này chỉ tính sau khi anh setup tuỳ chọn ở{" "}
            <a href="/hang-hoa/tuy-chon-fnb" className="text-primary underline">
              Tuỳ chọn món FnB
            </a>{" "}
            + khách đặt hàng có chọn modifier (vd Mức đường, Mức đá).
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupIds.map((gid) => {
            const rows = grouped[gid];
            const groupTotal = rows.reduce((s, r) => s + r.count, 0);
            const groupRev = rows.reduce((s, r) => s + r.totalPriceDelta, 0);
            return (
              <div key={gid} className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-surface-container-low border-b">
                  <div>
                    <h3 className="font-semibold">{rows[0].groupName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(groupTotal)} lượt chọn
                      {groupRev > 0 && ` • ${formatCurrency(groupRev)}đ phí cộng`}
                    </p>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground bg-surface-container-lowest">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold">Option</th>
                      <th className="text-right px-4 py-2 font-semibold w-28">Lượt chọn</th>
                      <th className="text-right px-4 py-2 font-semibold w-32">% trong nhóm</th>
                      <th className="text-right px-4 py-2 font-semibold w-28">SL món</th>
                      <th className="text-right px-4 py-2 font-semibold w-32">Phí cộng (đ)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const pct = r.percentInGroup ?? 0;
                      return (
                        <tr key={r.optionId} className="border-t hover:bg-surface-container-lowest/50">
                          <td className="px-4 py-2">{r.optionLabel}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatNumber(r.count)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <div className="w-16 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    pct >= 50 ? "bg-primary" : pct >= 20 ? "bg-status-info" : "bg-muted-foreground/50",
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-xs w-8">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatNumber(r.totalQuantity)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.totalPriceDelta > 0 ? formatCurrency(r.totalPriceDelta) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
