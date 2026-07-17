"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReportPageHeader } from "@/components/shared/report";
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
  all: "Táº¥t cáº£",
  self: "Tá»± Ä‘á»‘i chiáº¿u",
  cross: "Äá»‘i chiáº¿u há»™",
  big_variance: "ChÃªnh lá»‡ch lá»›n (> 5%)",
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
      "Chi nhÃ¡nh cá»§a nhÃ¢n viÃªn";

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
        title: "KhÃ´ng táº£i Ä‘Æ°á»£c bÃ¡o cÃ¡o Ä‘á»‘i chiáº¿u ca",
        description: err instanceof Error ? err.message : "Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh",
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
    name: "Chi tiáº¿t ca",
    titleRows: buildReportTitleRows({
      title: "BÃO CÃO Äá»I CHIáº¾U CA LÃ€M VIá»†C",
      range,
      branchName: effectiveBranchLabel,
    }),
    columns: [
      { label: "ÄÃ³ng lÃºc", key: "closedAt", width: 18 },
      { label: "Chi nhÃ¡nh", key: "branchName", width: 24 },
      { label: "Thu ngÃ¢n", key: "cashierName", width: 22 },
      { label: "NgÆ°á»i Ä‘á»‘i chiáº¿u", key: "reconciledByName", width: 22 },
      { label: "Sá»‘ Ä‘Æ¡n", key: "totalOrders", width: 12, format: "number" },
      { label: "Doanh thu", key: "totalSales", width: 18, format: "currency" },
      { label: "Tiá»n máº·t dá»± kiáº¿n", key: "expectedCash", width: 18, format: "currency" },
      { label: "Tiá»n máº·t thá»±c táº¿", key: "actualCash", width: 18, format: "currency" },
      { label: "ChÃªnh lá»‡ch", key: "variance", width: 18, format: "currency" },
      { label: "Tá»± Ä‘á»‘i chiáº¿u", key: "self", width: 14 },
      { label: "QuÃªn Ä‘Ã³ng ca", key: "autoPending", width: 14 },
      { label: "LÃ½ do", key: "reason", width: 36 },
      { label: "Ghi chÃº", key: "note", width: 36 },
    ],
    rows: filteredRows.map((row) => ({
      closedAt: formatDate(row.closedAt),
      branchName: row.branchName,
      cashierName: row.cashierName,
      reconciledByName: row.reconciledByName ?? "Chá»‘t trá»±c tiáº¿p",
      totalOrders: row.totalOrders,
      totalSales: row.totalSales,
      expectedCash: row.expectedCash,
      actualCash: row.actualCash,
      variance: row.variance,
      self: isSelfReconcile(row) ? "CÃ³" : "KhÃ´ng",
      autoPending: row.wasAutoMarkedPending ? "CÃ³" : "KhÃ´ng",
      reason: row.reason ?? "",
      note: row.note ?? "",
    })),
    footer: {
      closedAt: "Tá»”NG",
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
          name: "Tá»•ng há»£p",
          titleRows: buildReportTitleRows({
            title: "Tá»”NG Há»¢P Äá»I CHIáº¾U CA",
            range,
            branchName: effectiveBranchLabel,
          }),
          columns: [
            { label: "Chá»‰ tiÃªu", key: "metric", width: 32 },
            { label: "GiÃ¡ trá»‹", key: "value", width: 22 },
          ],
          rows: [
            { metric: "Tá»•ng ca Ä‘Ã£ Ä‘á»‘i chiáº¿u", value: kpi.total },
            { metric: "Tá»± Ä‘á»‘i chiáº¿u", value: `${kpi.selfCount} (${kpi.selfPct}%)` },
            { metric: "ChÃªnh lá»‡ch lá»›n trÃªn 5%", value: kpi.bigVarianceCount },
            { metric: "Tá»•ng thá»«a quá»¹", value: formatCurrency(kpi.totalSurplus) },
            { metric: "Tá»•ng thiáº¿u quá»¹", value: formatCurrency(kpi.totalShortage) },
          ],
        });
      }
      sheets.push(detailSheet());
      await exportReportToExcel({
        kind: "doi-chieu-ca",
        mode,
        range,
        branchName: effectiveBranchLabel,
        reportTitle: "BÃ¡o cÃ¡o Ä‘á»‘i chiáº¿u ca lÃ m viá»‡c",
        description: "Äá»‘i soÃ¡t ngÆ°á»i chá»‘t ca, tiá»n máº·t dá»± kiáº¿n, thá»±c táº¿ vÃ  chÃªnh lá»‡ch.",
        sheets,
      });
      toast({ title: "ÄÃ£ xuáº¥t bÃ¡o cÃ¡o Ä‘á»‘i chiáº¿u ca", variant: "success" });
    } catch (err) {
      toast({
        title: "Lá»—i xuáº¥t Excel",
        description: err instanceof Error ? err.message : "KhÃ´ng thá»ƒ táº¡o file",
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
              <p className="font-semibold text-status-error">Báº¡n khÃ´ng cÃ³ quyá»n xem bÃ¡o cÃ¡o Ä‘á»‘i chiáº¿u ca</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cáº§n quyá»n Ä‘á»‘i chiáº¿u ca má»i chi nhÃ¡nh hoáº·c Ä‘á»‘i chiáº¿u ca chi nhÃ¡nh mÃ¬nh.
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
        title="Äá»‘i chiáº¿u ca lÃ m viá»‡c"
        subtitle="Theo dÃµi ngÆ°á»i chá»‘t ca, chÃªnh lá»‡ch quá»¹ vÃ  cÃ¡c trÆ°á»ng há»£p cáº§n kiá»ƒm tra"
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
            <label className="text-xs text-muted-foreground">Loáº¡i Ä‘á»‘i chiáº¿u</label>
            <Select value={type} onValueChange={(value) => value && setType(value as NonNullable<ReconciledShiftFilter["type"]>)}>
              <SelectTrigger aria-label="Loáº¡i Ä‘á»‘i chiáº¿u">
                <SelectValue>{RECONCILIATION_TYPE_LABELS[type]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Táº¥t cáº£</SelectItem>
                <SelectItem value="self">Tá»± Ä‘á»‘i chiáº¿u</SelectItem>
                <SelectItem value="cross">Äá»‘i chiáº¿u há»™</SelectItem>
                <SelectItem value="big_variance">ChÃªnh lá»‡ch lá»›n (&gt; 5%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">TÃ¬m kiáº¿m</label>
            <Input placeholder="TÃªn thu ngÃ¢n, ngÆ°á»i Ä‘á»‘i chiáº¿u, lÃ½ do..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Tá»•ng ca Ä‘Ã£ Ä‘á»‘i chiáº¿u" value={kpi.total.toString()} icon="fact_check" bg="bg-primary/10" iconColor="text-primary" valueColor="text-foreground" />
          <KpiCard label="Tá»± Ä‘á»‘i chiáº¿u" value={`${kpi.selfCount} (${kpi.selfPct}%)`} icon="person" bg="bg-status-warning/10" iconColor="text-status-warning" valueColor="text-status-warning" />
          <KpiCard label="Tá»•ng thá»«a quá»¹" value={`+${formatCurrency(kpi.totalSurplus)}`} icon="add_circle" bg="bg-status-success/10" iconColor="text-status-success" valueColor="text-status-success" />
          <KpiCard label="Tá»•ng thiáº¿u quá»¹" value={`-${formatCurrency(kpi.totalShortage)}`} icon="remove_circle" bg="bg-status-error/10" iconColor="text-status-error" valueColor="text-status-error" />
        </div>

        <div className="overflow-hidden rounded-lg bg-surface-container-lowest ambient-shadow">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground"><Icon name="progress_activity" className="mr-2 animate-spin" />Äang táº£i dá»¯ liá»‡u...</div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground"><Icon name="inbox" size={32} className="mb-2 opacity-40" />KhÃ´ng cÃ³ ca Ä‘Ã£ Ä‘á»‘i chiáº¿u trong ká»³ vÃ  pháº¡m vi Ä‘Ã£ chá»n</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-container-low text-xs font-semibold uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">ÄÃ³ng lÃºc</th><th className="px-3 py-2 text-left">Chi nhÃ¡nh</th><th className="px-3 py-2 text-left">Thu ngÃ¢n</th><th className="px-3 py-2 text-left">NgÆ°á»i Ä‘á»‘i chiáº¿u</th><th className="px-3 py-2 text-right">Sá»‘ Ä‘Æ¡n</th><th className="px-3 py-2 text-right">Doanh thu</th><th className="px-3 py-2 text-right">Dá»± kiáº¿n</th><th className="px-3 py-2 text-right">Thá»±c táº¿</th><th className="px-3 py-2 text-right">ChÃªnh lá»‡ch</th><th className="px-3 py-2 text-center">Cá»</th><th className="px-3 py-2 text-left">LÃ½ do</th>
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
                        <td className="px-3 py-2">{row.reconciledByName ?? <span className="italic text-muted-foreground">Chá»‘t trá»±c tiáº¿p</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.totalOrders}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.totalSales)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.expectedCash)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.actualCash)}</td>
                        <td className={cn("px-3 py-2 text-right font-medium tabular-nums", row.variance === 0 ? "text-status-success" : row.variance > 0 ? "text-status-warning" : "text-status-error")}>{row.variance > 0 && "+"}{formatCurrency(row.variance)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            {self && <span className="inline-flex items-center gap-0.5 rounded-md bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warning" title="NgÆ°á»i Ä‘á»‘i chiáº¿u trÃ¹ng thu ngÃ¢n"><Icon name="person" size={12} />Tá»±</span>}
                            {big && <span className="inline-flex items-center gap-0.5 rounded-md bg-status-error/10 px-1.5 py-0.5 text-[10px] font-medium text-status-error" title="ChÃªnh lá»‡ch trÃªn 5% dá»± kiáº¿n"><Icon name="warning" size={12} />Lá»›n</span>}
                            {row.wasAutoMarkedPending && <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Ca Ä‘Æ°á»£c tá»± Ä‘á»™ng Ä‘Ã¡nh dáº¥u chá» xá»­ lÃ½"><Icon name="schedule" size={12} />QuÃªn</span>}
                          </div>
                        </td>
                        <td className="max-w-xs px-3 py-2 text-xs text-muted-foreground"><div className="line-clamp-2">{row.reason ?? "â€”"}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

