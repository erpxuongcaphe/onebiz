"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import {
  createKpiBreakdown,
  getBranches,
  getKpiBreakdowns,
} from "@/lib/services";
import {
  KPI_PERIOD_LABELS,
  KPI_TYPE_LABELS,
  type KpiBreakdown,
  type KpiPeriod,
  type KpiType,
} from "@/lib/types/ai-agents";
import type { BranchDetail } from "@/lib/services/supabase/branches";

interface CreateKpiBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Nếu truyền vào, form sẽ prefill parent và default period từ parent */
  parentKpi?: KpiBreakdown | null;
}

const PERIOD_OPTIONS: KpiPeriod[] = [
  "yearly",
  "quarterly",
  "monthly",
  "weekly",
  "daily",
];

const TYPE_OPTIONS: KpiType[] = [
  "revenue",
  "orders",
  "customers",
  "profit",
  "inventory",
  "tasks",
  "custom",
];

/** Suy ra period_start/end mặc định từ period (hôm nay). */
function defaultRangeForPeriod(period: KpiPeriod, anchor = new Date()): {
  start: string;
  end: string;
} {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);

  if (period === "daily") {
    const iso = d.toISOString().slice(0, 10);
    return { start: iso, end: iso };
  }
  if (period === "weekly") {
    const day = d.getDay() || 7; // Mon = 1 … Sun = 7
    const mon = new Date(d);
    mon.setDate(d.getDate() - (day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      start: mon.toISOString().slice(0, 10),
      end: sun.toISOString().slice(0, 10),
    };
  }
  if (period === "monthly") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  if (period === "quarterly") {
    const q = Math.floor(d.getMonth() / 3);
    const start = new Date(d.getFullYear(), q * 3, 1);
    const end = new Date(d.getFullYear(), q * 3 + 3, 0);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  // yearly
  const start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d.getFullYear(), 11, 31);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function CreateKpiBreakdownDialog({
  open,
  onOpenChange,
  onSuccess,
  parentKpi,
}: CreateKpiBreakdownDialogProps) {
  const { toast } = useToast();

  const [kpiName, setKpiName] = useState("");
  const [kpiType, setKpiType] = useState<KpiType>("revenue");
  const [period, setPeriod] = useState<KpiPeriod>("monthly");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [actualValue, setActualValue] = useState("");
  const [unit, setUnit] = useState("VND");
  const [ownerRole, setOwnerRole] = useState("");
  const [branchId, setBranchId] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");

  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [allKpis, setAllKpis] = useState<KpiBreakdown[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [b, k] = await Promise.all([getBranches(), getKpiBreakdowns()]);
        setBranches(b);
        setAllKpis(k);
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : "Lỗi tải dữ liệu",
          variant: "error",
        });
      }
    })();
  }, [open, toast]);

  // Reset + prefill khi mở
  useEffect(() => {
    if (!open) return;
    const defaultPeriod: KpiPeriod =
      (parentKpi?.period as KpiPeriod | undefined) ?? "monthly";
    const range = defaultRangeForPeriod(defaultPeriod);

    setKpiName("");
    setKpiType((parentKpi?.kpiType as KpiType | undefined) ?? "revenue");
    setPeriod(defaultPeriod);
    setPeriodStart(parentKpi?.periodStart?.slice(0, 10) ?? range.start);
    setPeriodEnd(parentKpi?.periodEnd?.slice(0, 10) ?? range.end);
    setTargetValue("");
    setActualValue("");
    setUnit(parentKpi?.unit ?? "VND");
    setOwnerRole(parentKpi?.ownerRole ?? "");
    setBranchId(parentKpi?.branchId ?? "");
    setParentId(parentKpi?.id ?? "");
    setDescription("");
  }, [open, parentKpi]);

  const handlePeriodChange = (p: KpiPeriod) => {
    setPeriod(p);
    const range = defaultRangeForPeriod(p);
    setPeriodStart(range.start);
    setPeriodEnd(range.end);
  };

  const handleSave = async () => {
    if (!kpiName.trim()) {
      toast({ title: "Thiếu tên KPI", variant: "error" });
      return;
    }
    const t = Number(targetValue);
    if (!targetValue || !Number.isFinite(t) || t < 0) {
      toast({ title: "Mục tiêu không hợp lệ", variant: "error" });
      return;
    }
    if (!periodStart || !periodEnd) {
      toast({ title: "Thiếu khoảng thời gian", variant: "error" });
      return;
    }
    if (periodStart > periodEnd) {
      toast({ title: "Ngày bắt đầu sau ngày kết thúc", variant: "error" });
      return;
    }

    const a = actualValue === "" ? 0 : Number(actualValue);
    if (!Number.isFinite(a) || a < 0) {
      toast({ title: "Thực tế không hợp lệ", variant: "error" });
      return;
    }

    setSaving(true);
    try {
      await createKpiBreakdown({
        parentId: parentId || undefined,
        kpiName: kpiName.trim(),
        kpiType,
        period,
        periodStart,
        periodEnd,
        targetValue: t,
        actualValue: a,
        unit: unit.trim() || undefined,
        ownerRole: ownerRole.trim() || undefined,
        branchId: branchId || undefined,
        metadata: description.trim() ? { description: description.trim() } : {},
      });
      toast({ title: "Đã tạo KPI", variant: "success" });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi tạo KPI",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {parentKpi ? `Tạo KPI con thuộc "${parentKpi.kpiName}"` : "Tạo KPI"}
          </DialogTitle>
          <DialogDescription>
            KPI được break down theo kỳ (năm/quý/tháng/tuần/ngày) và gắn với
            chi nhánh + vai trò phụ trách.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Tên + mô tả */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tên KPI <span className="text-destructive">*</span>
            </label>
            <Input
              value={kpiName}
              onChange={(e) => setKpiName(e.target.value)}
              placeholder="VD: Doanh thu tháng 4/2026"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mô tả (tuỳ chọn)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ngữ cảnh, công thức tính, nguồn dữ liệu..."
              rows={2}
            />
          </div>

          {/* Loại + kỳ */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Loại KPI <span className="text-destructive">*</span>
              </label>
              <select
                value={kpiType}
                onChange={(e) => setKpiType(e.target.value as KpiType)}
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {KPI_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chu kỳ <span className="text-destructive">*</span>
              </label>
              <select
                value={period}
                onChange={(e) => handlePeriodChange(e.target.value as KpiPeriod)}
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {KPI_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Khoảng thời gian */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Từ ngày <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Đến ngày <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>

          {/* Mục tiêu + thực tế + đơn vị */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Mục tiêu <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                inputMode="numeric"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="500000000"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Thực tế</label>
              <Input
                type="number"
                inputMode="numeric"
                value={actualValue}
                onChange={(e) => setActualValue(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Đơn vị</label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="VND / đơn / khách"
              />
            </div>
          </div>

          {/* Owner + chi nhánh */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Role phụ trách</label>
              <Input
                value={ownerRole}
                onChange={(e) => setOwnerRole(e.target.value)}
                placeholder="ceo / manager-branch-A / cashier"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Chi nhánh</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <option value="">— Toàn doanh nghiệp —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* KPI cha */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              KPI cha (tạo tree breakdown)
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={Boolean(parentKpi)}
              className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60"
            >
              <option value="">— KPI gốc (không có cha) —</option>
              {allKpis
                .filter((k) => k.id !== parentKpi?.id) // không tự chọn mình
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.kpiName} ({KPI_PERIOD_LABELS[k.period]})
                  </option>
                ))}
            </select>
            {parentKpi && (
              <p className="text-xs text-muted-foreground">
                Đã khoá vào &ldquo;{parentKpi.kpiName}&rdquo;.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <Icon
                name="progress_activity"
                size={16}
                className="mr-1.5 animate-spin"
              />
            )}
            Tạo KPI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
