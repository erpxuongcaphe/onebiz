"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatDate } from "@/lib/format";
import { useReportState } from "@/lib/hooks/use-report-state";
import { usePermissions } from "@/lib/permissions";
import {
  getReconciledShifts,
  type ReconciledShiftFilter,
  type ReconciledShiftRow,
} from "@/lib/services/supabase/shifts";
import { cn } from "@/lib/utils";
import {
  buildReportTitleRows,
  exportReportToExcel,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { KpiCard } from "../_components";

const RECONCILIATION_TYPE_LABELS: Record<
  NonNullable<ReconciledShiftFilter["type"]>,
  string
> = {
  all: "Tất cả",
  self: "Tự đối chiếu",
  cross: "Đối chiếu hộ",
  big_variance: "Chênh lệch lớn (> 5%)",
};

function isSelfReconcile(row: ReconciledShiftRow): boolean {
  return !!row.reconciledById && row.reconciledById === row.cashierId;
}

function isBigVariance(row: ReconciledShiftRow): boolean {
  return row.expectedCash > 0 && Math.abs(row.variance) / row.expectedCash > 0.05;
}

export default function ReconciledShiftReportPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    activeBranchId,
    branches,
    branchLabel,
    isReady,
  } = useBranchFilter();
  const { hasPermission } = usePermissions();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultPreset: "last30Days",
    defaultViewMode: "table",
    forceTable: true,
  });

  const canViewAny = hasPermission("shifts.reconcile_any");
  const canViewOwn = hasPermission("shifts.reconcile_own_branch");
  const canView = canViewAny || canViewOwn;
  const effectiveBranchId = canViewAny ? activeBranchId : user?.branchId;
  const effectiveBranchLabel = canViewAny
    ? branchLabel
    : branches.find((branch) => branch.id === user?.branchId)?.name ??
      "Chi nhánh của nhân viên";

  const [type, setType] = useState<NonNullable<ReconciledShiftFilter["type"]>>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ReconciledShiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!canView || !isReady || (!canViewAny && !effectiveBranchId)) return;
    setLoading(true);
    try {
      const data = await getReconciledShifts({
        branchId: effectiveBranchId,
        dateFrom: range.from,
        dateTo: range.to,
        type,
      });
      setRows(data);
    } catch (err) {
      setRows([]);
      toast({
        title: "Không tải được báo cáo đối chiếu ca",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [canView, canViewAny, effectiveBranchId, isReady, range.from, range.to, toast, type]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(
      (row) =>
        row.cashierName.toLowerCase().includes(keyword) ||
        (row.reconciledByName ?? "").toLowerCase().includes(keyword) ||
        row.branchName.toLowerCase().includes(keyword) ||
        (row.reason ?? "").toLowerCase().includes(keyword),
    );
  }, [rows, search]);

  const kpi = useMemo(() => {
    const total = filteredRows.length;
    const selfCount = filteredRows.filter(isSelfReconcile).length;
    return {
      total,
      selfCount,
      selfPct: total > 0 ? Math.round((selfCount / total) * 100) : 0,
      bigVarianceCount: filteredRows.filter(isBigVariance).length,
      totalSurplus: filteredRows
        .filter((row) => row.variance > 0)
        .reduce((sum, row) => sum + row.variance, 0),
      totalShortage: filteredRows
        .filter((row) => row.variance < 0)
        .reduce((sum, row) => sum + Math.abs(row.variance), 0),
    };
  }, [filteredRows]);

  const detailSheet = useCallback((): ExcelSheet => ({
    name: "Chi tiết ca",
    titleRows: buildReportTitleRows({
      title: "BÁO CÁO ĐỐI CHIẾU CA LÀM VIỆC",
      range,
      branchName: effectiveBranchLabel,
    }),
    columns: [
      { label: "Đóng lúc", key: "closedAt", width: 18 },
      { label: "Chi nhánh", key: "branchName", width: 24 },
      { label: "Thu ngân", key: "cashierName", width: 22 },
      { label: "Người đối chiếu", key: "reconciledByName", width: 22 },
      { label: "Số đơn", key: "totalOrders", width: 12, format: "number" },
      { label: "Doanh thu", key: "totalSales", width: 18, format: "currency" },
      { label: "Tiền mặt dự kiến", key: "expectedCash", width: 18, format: "currency" },
      { label: "Tiền mặt thực tế", key: "actualCash", width: 18, format: "currency" },
      { label: "Chênh lệch", key: "variance", width: 18, format: "currency" },
      { label: "Tự đối chiếu", key: "self", width: 14 },
      { label: "Quên đóng ca", key: "autoPending", width: 14 },
      { label: "Lý do", key: "reason", width: 36 },
      { label: "Ghi chú", key: "note", width: 36 },
    ],
    rows: filteredRows.map((row) => ({
      closedAt: formatDate(row.closedAt),
      branchName: row.branchName,
      cashierName: row.cashierName,
      reconciledByName: row.reconciledByName ?? "Chốt trực tiếp",
      totalOrders: row.totalOrders,
      totalSales: row.totalSales,
      expectedCash: row.expectedCash,
      actualCash: row.actualCash,
      variance: row.variance,
      self: isSelfReconcile(row) ? "Có" : "Không",
      autoPending: row.wasAutoMarkedPending ? "Có" : "Không",
      reason: row.reason ?? "",
      note: row.note ?? "",
    })),
    footer: {
      closedAt: "TỔNG",
      branchName: "",
      cashierName: "",
      reconciledByName: "",
      totalOrders: filteredRows.reduce((sum, row) => sum + row.totalOrders, 0),
      totalSales: filteredRows.reduce((sum, row) => sum + row.totalSales, 0),
      expectedCash: filteredRows.reduce((sum, row) => sum + row.expectedCash, 0),
      actualCash: filteredRows.reduce((sum, row) => sum + row.actualCash, 0),
      variance: filteredRows.reduce((sum, row) => sum + row.variance, 0),
      self: "",
      autoPending: "",
      reason: "",
      note: "",
    },
  }), [effectiveBranchLabel, filteredRows, range]);

  const handleExport = useCallback(async (mode: "view" | "full") => {
    try {
      const sheets: ExcelSheet[] = [];
      if (mode === "full") {
        sheets.push({
          name: "Tổng hợp",
          titleRows: buildReportTitleRows({
            title: "TỔNG HỢP ĐỐI CHIẾU CA",
            range,
            branchName: effectiveBranchLabel,
          }),
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 32 },
            { label: "Giá trị", key: "value", width: 22 },
          ],
          rows: [
            { metric: "Tổng ca đã đối chiếu", value: kpi.total },
            { metric: "Tự đối chiếu", value: `${kpi.selfCount} (${kpi.selfPct}%)` },
            { metric: "Chênh lệch lớn trên 5%", value: kpi.bigVarianceCount },
            { metric: "Tổng thừa quỹ", value: formatCurrency(kpi.totalSurplus) },
            { metric: "Tổng thiếu quỹ", value: formatCurrency(kpi.totalShortage) },
          ],
        });
      }
      sheets.push(detailSheet());
      await exportReportToExcel({
        kind: "doi-chieu-ca",
        mode,
        range,
        branchName: effectiveBranchLabel,
        reportTitle: "Báo cáo đối chiếu ca làm việc",
        description: "Đối soát người chốt ca, tiền mặt dự kiến, thực tế và chênh lệch.",
        sheets,
      });
      toast({ title: "Đã xuất báo cáo đối chiếu ca", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Không thể tạo file",
        variant: "error",
      });
    }
  }, [detailSheet, effectiveBranchLabel, kpi, range, toast]);

  if (!canView) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-status-error/40 bg-status-error/10 p-4 text-sm">
          <div className="flex items-start gap-2">
            <Icon name="block" className="mt-0.5 text-status-error" />
            <div>
              <p className="font-semibold text-status-error">Bạn không có quyền xem báo cáo đối chiếu ca</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cần quyền đối chiếu ca mọi chi nhánh hoặc đối chiếu ca chi nhánh mình.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ReportPageHeader
        title="Đối chiếu ca làm việc"
        subtitle="Theo dõi người chốt ca, chênh lệch quỹ và các trường hợp cần kiểm tra"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={() => handleExport("view")}
        onExportFull={() => handleExport("full")}
        exportDisabled={loading || filteredRows.length === 0}
        hideBranchScope={!canViewAny}
      />

      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-1 gap-2 rounded-lg bg-surface-container-low p-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Loại đối chiếu</label>
            <Select value={type} onValueChange={(value) => value && setType(value as NonNullable<ReconciledShiftFilter["type"]>)}>
              <SelectTrigger aria-label="Loại đối chiếu">
                <SelectValue>{RECONCILIATION_TYPE_LABELS[type]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="self">Tự đối chiếu</SelectItem>
                <SelectItem value="cross">Đối chiếu hộ</SelectItem>
                <SelectItem value="big_variance">Chênh lệch lớn (&gt; 5%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tìm kiếm</label>
            <Input placeholder="Tên thu ngân, người đối chiếu, lý do..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Tổng ca đã đối chiếu" value={kpi.total.toString()} icon="fact_check" bg="bg-primary/10" iconColor="text-primary" valueColor="text-foreground" />
          <KpiCard label="Tự đối chiếu" value={`${kpi.selfCount} (${kpi.selfPct}%)`} icon="person" bg="bg-status-warning/10" iconColor="text-status-warning" valueColor="text-status-warning" />
          <KpiCard label="Tổng thừa quỹ" value={`+${formatCurrency(kpi.totalSurplus)}`} icon="add_circle" bg="bg-status-success/10" iconColor="text-status-success" valueColor="text-status-success" />
          <KpiCard label="Tổng thiếu quỹ" value={`-${formatCurrency(kpi.totalShortage)}`} icon="remove_circle" bg="bg-status-error/10" iconColor="text-status-error" valueColor="text-status-error" />
        </div>

        <div className="overflow-hidden rounded-lg bg-surface-container-lowest ambient-shadow">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground"><Icon name="progress_activity" className="mr-2 animate-spin" />Đang tải dữ liệu...</div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground"><Icon name="inbox" size={32} className="mb-2 opacity-40" />Không có ca đã đối chiếu trong kỳ và phạm vi đã chọn</div>
          ) : (
            <ReportTableFrame tablePreferenceKey="report.shift-reconciliation.rows">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-container-low text-xs font-semibold uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Đóng lúc</th><th className="px-3 py-2 text-left">Chi nhánh</th><th className="px-3 py-2 text-left">Thu ngân</th><th className="px-3 py-2 text-left">Người đối chiếu</th><th className="px-3 py-2 text-right">Số đơn</th><th className="px-3 py-2 text-right">Doanh thu</th><th className="px-3 py-2 text-right">Dự kiến</th><th className="px-3 py-2 text-right">Thực tế</th><th className="px-3 py-2 text-right">Chênh lệch</th><th className="px-3 py-2 text-center">Cờ</th><th className="px-3 py-2 text-left">Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const self = isSelfReconcile(row);
                    const big = isBigVariance(row);
                    return (
                      <tr key={row.id} className="border-t border-border hover:bg-surface-container-low/50">
                        <td className="whitespace-nowrap px-3 py-2">{formatDate(row.closedAt)}</td>
                        <td className="px-3 py-2">{row.branchName}</td>
                        <td className="px-3 py-2">{row.cashierName}</td>
                        <td className="px-3 py-2">{row.reconciledByName ?? <span className="italic text-muted-foreground">Chốt trực tiếp</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.totalOrders}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.totalSales)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.expectedCash)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.actualCash)}</td>
                        <td className={cn("px-3 py-2 text-right font-medium tabular-nums", row.variance === 0 ? "text-status-success" : row.variance > 0 ? "text-status-warning" : "text-status-error")}>{row.variance > 0 && "+"}{formatCurrency(row.variance)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            {self && <span className="inline-flex items-center gap-0.5 rounded-md bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warning" title="Người đối chiếu trùng thu ngân"><Icon name="person" size={12} />Tự</span>}
                            {big && <span className="inline-flex items-center gap-0.5 rounded-md bg-status-error/10 px-1.5 py-0.5 text-[10px] font-medium text-status-error" title="Chênh lệch trên 5% dự kiến"><Icon name="warning" size={12} />Lớn</span>}
                            {row.wasAutoMarkedPending && <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Ca được tự động đánh dấu chờ xử lý"><Icon name="schedule" size={12} />Quên</span>}
                          </div>
                        </td>
                        <td className="max-w-xs px-3 py-2 text-xs text-muted-foreground"><div className="line-clamp-2">{row.reason ?? "—"}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </ReportTableFrame>
          )}
        </div>
      </div>
    </div>
  );
}
