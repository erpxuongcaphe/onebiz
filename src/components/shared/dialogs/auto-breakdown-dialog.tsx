"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import { formatNumber, formatShortDate } from "@/lib/format";
import {
  autoBreakdownKpi,
  getBranches,
  splitPeriod,
  type BranchDistribution,
  type BreakdownStrategy,
} from "@/lib/services";
import {
  KPI_PERIOD_LABELS,
  type KpiBreakdown,
  type KpiPeriod,
} from "@/lib/types/ai-agents";
import type { BranchDetail } from "@/lib/services/supabase/branches";
import { cn } from "@/lib/utils";

interface AutoBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** KPI cha sẽ được chia nhỏ */
  parentKpi: KpiBreakdown | null;
  onSuccess?: () => void;
}

const PERIOD_RANK: Record<KpiPeriod, number> = {
  yearly: 5,
  quarterly: 4,
  monthly: 3,
  weekly: 2,
  daily: 1,
};

/** Các period con hợp lệ (nhỏ hơn parent period) */
function validSubPeriods(parent: KpiPeriod): KpiPeriod[] {
  const rank = PERIOD_RANK[parent];
  return (Object.keys(PERIOD_RANK) as KpiPeriod[]).filter(
    (p) => PERIOD_RANK[p] < rank,
  );
}

export function AutoBreakdownDialog({
  open,
  onOpenChange,
  parentKpi,
  onSuccess,
}: AutoBreakdownDialogProps) {
  const { toast } = useToast();

  const [strategy, setStrategy] = useState<BreakdownStrategy>("time");
  const [targetSubPeriod, setTargetSubPeriod] = useState<KpiPeriod>("monthly");
  const [branchDistribution, setBranchDistribution] =
    useState<BranchDistribution>("even");
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(
    new Set(),
  );

  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [saving, setSaving] = useState(false);

  // Load danh sách chi nhánh
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const bs = await getBranches();
        const active = bs.filter((b) => b.isActive !== false);
        setBranches(active);
        setSelectedBranches(new Set(active.map((b) => b.id)));
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : "Lỗi tải chi nhánh",
          variant: "error",
        });
      }
    })();
  }, [open, toast]);

  // Reset khi đóng hoặc đổi parent
  useEffect(() => {
    if (!open) return;
    setStrategy("time");
    setBranchDistribution("even");
    if (parentKpi) {
      const subs = validSubPeriods(parentKpi.period);
      if (subs.length > 0) setTargetSubPeriod(subs[0]);
    }
  }, [open, parentKpi]);

  // Tính số KPI con sẽ tạo (preview)
  const previewCount = useMemo(() => {
    if (!parentKpi) return 0;
    if (strategy === "time") {
      if (!targetSubPeriod) return 0;
      try {
        return splitPeriod(
          parentKpi.periodStart,
          parentKpi.periodEnd,
          targetSubPeriod,
        ).length;
      } catch {
        return 0;
      }
    }
    // branch
    return selectedBranches.size;
  }, [parentKpi, strategy, targetSubPeriod, selectedBranches]);

  const validTargetSubPeriods: KpiPeriod[] = useMemo(() => {
    if (!parentKpi) return [];
    return validSubPeriods(parentKpi.period);
  }, [parentKpi]);

  const toggleBranch = (id: string) => {
    setSelectedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllBranches = () => {
    if (selectedBranches.size === branches.length) {
      setSelectedBranches(new Set());
    } else {
      setSelectedBranches(new Set(branches.map((b) => b.id)));
    }
  };

  const handleRun = async () => {
    if (!parentKpi) return;

    if (strategy === "time" && validTargetSubPeriods.length === 0) {
      toast({
        title: `KPI cha có kỳ "${KPI_PERIOD_LABELS[parentKpi.period]}" không thể chia nhỏ hơn`,
        variant: "error",
      });
      return;
    }

    if (strategy === "branch" && selectedBranches.size === 0) {
      toast({ title: "Chọn ít nhất 1 chi nhánh", variant: "error" });
      return;
    }

    if (previewCount === 0) {
      toast({
        title: "Không có KPI con nào được tạo — kiểm tra lại cấu hình",
        variant: "error",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await autoBreakdownKpi({
        parentId: parentKpi.id,
        strategy,
        targetSubPeriod:
          strategy === "time" ? targetSubPeriod : undefined,
        branchDistribution:
          strategy === "branch" ? branchDistribution : undefined,
        branchIds:
          strategy === "branch" ? Array.from(selectedBranches) : undefined,
      });

      toast({
        title: `Đã tạo ${result.children.length} KPI con`,
        description:
          result.warnings.length > 0 ? result.warnings.join(" · ") : undefined,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi chia nhỏ KPI",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!parentKpi) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tự động chia nhỏ KPI</DialogTitle>
          <DialogDescription>
            Chia KPI cha thành các KPI con theo thời gian hoặc theo chi nhánh.
            Target được phân bổ tự động.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Parent KPI info */}
          <div className="rounded-xl border border-border bg-surface-container p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="account_tree" size={16} className="text-primary" />
              <span className="font-semibold text-sm">
                {parentKpi.kpiName}
              </span>
              <span className="text-[10px] uppercase tracking-wider font-medium rounded-full px-2 py-0.5 bg-primary-fixed text-primary">
                {KPI_PERIOD_LABELS[parentKpi.period]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Mục tiêu:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatNumber(parentKpi.targetValue)}
              </span>
              {parentKpi.unit && ` ${parentKpi.unit}`} ·{" "}
              {formatShortDate(parentKpi.periodStart)} →{" "}
              {formatShortDate(parentKpi.periodEnd)}
            </div>
          </div>

          {/* Strategy selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Chiến lược chia <span className="text-destructive">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStrategy("time")}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors press-scale-sm",
                  strategy === "time"
                    ? "border-primary bg-primary-fixed"
                    : "border-border bg-surface-container-lowest hover:bg-surface-container",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon
                    name="event_repeat"
                    size={16}
                    className={
                      strategy === "time"
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  />
                  <span className="font-semibold text-sm">Theo thời gian</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  VD: KPI năm → 4 KPI quý hoặc 12 KPI tháng
                </p>
              </button>
              <button
                type="button"
                onClick={() => setStrategy("branch")}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors press-scale-sm",
                  strategy === "branch"
                    ? "border-primary bg-primary-fixed"
                    : "border-border bg-surface-container-lowest hover:bg-surface-container",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon
                    name="storefront"
                    size={16}
                    className={
                      strategy === "branch"
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  />
                  <span className="font-semibold text-sm">Theo chi nhánh</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  VD: KPI tháng → N KPI con cho từng quán/kho/xưởng
                </p>
              </button>
            </div>
          </div>

          {/* Strategy: time options */}
          {strategy === "time" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chia thành kỳ <span className="text-destructive">*</span>
              </label>
              {validTargetSubPeriods.length === 0 ? (
                <p className="text-xs text-status-error">
                  KPI cha đã ở kỳ nhỏ nhất ({KPI_PERIOD_LABELS[parentKpi.period]}
                  ) — không thể chia nhỏ hơn. Hãy dùng chiến lược theo chi
                  nhánh.
                </p>
              ) : (
                <select
                  value={targetSubPeriod}
                  onChange={(e) =>
                    setTargetSubPeriod(e.target.value as KpiPeriod)
                  }
                  className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {validTargetSubPeriods.map((p) => (
                    <option key={p} value={p}>
                      {KPI_PERIOD_LABELS[p]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Strategy: branch options */}
          {strategy === "branch" && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Phân bổ target <span className="text-destructive">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBranchDistribution("even")}
                    className={cn(
                      "rounded-xl border p-2.5 text-left transition-colors press-scale-sm",
                      branchDistribution === "even"
                        ? "border-primary bg-primary-fixed"
                        : "border-border bg-surface-container-lowest hover:bg-surface-container",
                    )}
                  >
                    <div className="text-sm font-semibold">Chia đều</div>
                    <p className="text-[11px] text-muted-foreground">
                      Mỗi chi nhánh nhận target như nhau
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranchDistribution("historical")}
                    className={cn(
                      "rounded-xl border p-2.5 text-left transition-colors press-scale-sm",
                      branchDistribution === "historical"
                        ? "border-primary bg-primary-fixed"
                        : "border-border bg-surface-container-lowest hover:bg-surface-container",
                    )}
                  >
                    <div className="text-sm font-semibold">
                      Theo lịch sử (90 ngày)
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Chi nhánh doanh thu cao nhận target cao
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Chi nhánh áp dụng
                  </label>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={toggleAllBranches}
                    className="text-xs"
                  >
                    {selectedBranches.size === branches.length
                      ? "Bỏ chọn tất cả"
                      : "Chọn tất cả"}
                  </Button>
                </div>
                <div className="rounded-xl border border-border bg-surface-container-lowest max-h-48 overflow-y-auto">
                  {branches.length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">
                      Chưa có chi nhánh active
                    </p>
                  ) : (
                    branches.map((b) => (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 p-2.5 hover:bg-surface-container cursor-pointer border-b border-border/40 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedBranches.has(b.id)}
                          onChange={() => toggleBranch(b.id)}
                          className="size-4 rounded border-border accent-primary"
                        />
                        <span className="text-sm flex-1">{b.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {b.branchType}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* Preview */}
          <div className="rounded-xl bg-status-info/5 border border-status-info/20 p-3 flex items-start gap-2">
            <Icon
              name="info"
              size={16}
              className="text-status-info shrink-0 mt-0.5"
            />
            <div className="text-xs">
              <p className="font-semibold text-status-info mb-0.5">
                Sẽ tạo {previewCount} KPI con
              </p>
              <p className="text-muted-foreground">
                {strategy === "time"
                  ? `Mỗi KPI con = ${formatNumber(parentKpi.targetValue)} ÷ ${previewCount || 1} = ${formatNumber(Math.round(parentKpi.targetValue / (previewCount || 1)))}${parentKpi.unit ? ` ${parentKpi.unit}` : ""}`
                  : branchDistribution === "even"
                    ? `Mỗi chi nhánh: ${formatNumber(Math.round(parentKpi.targetValue / (previewCount || 1)))}${parentKpi.unit ? ` ${parentKpi.unit}` : ""}`
                    : "Target được phân bổ theo tỉ trọng doanh thu 90 ngày gần nhất"}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            onClick={handleRun}
            disabled={saving || previewCount === 0}
          >
            {saving && (
              <Icon
                name="progress_activity"
                size={16}
                className="mr-1.5 animate-spin"
              />
            )}
            Tạo {previewCount} KPI con
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
