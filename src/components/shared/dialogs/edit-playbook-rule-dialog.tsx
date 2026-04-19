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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/lib/contexts";
import {
  AGENT_TASK_PRIORITY_LABELS,
  KPI_PERIOD_LABELS,
  KPI_TYPE_LABELS,
  PLAYBOOK_TRIGGER_LABELS,
  type AgentTaskPriority,
  type KpiPeriod,
  type KpiType,
  type PlaybookRule,
  type PlaybookTriggerType,
} from "@/lib/types/ai-agents";

interface EditPlaybookRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mới, có value = edit */
  initialRule: PlaybookRule | null;
  onSave: (rule: PlaybookRule) => void;
}

const ALL_KPI_TYPES: KpiType[] = [
  "revenue",
  "orders",
  "customers",
  "profit",
  "inventory",
  "tasks",
  "custom",
];
const ALL_PERIODS: KpiPeriod[] = [
  "yearly",
  "quarterly",
  "monthly",
  "weekly",
  "daily",
];
const ALL_TRIGGERS: PlaybookTriggerType[] = [
  "progress_low",
  "progress_high",
  "no_activity",
  "periodic_review",
];
const ALL_PRIORITIES: AgentTaskPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];

function genId(): string {
  return `r-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyRule(): PlaybookRule {
  return {
    id: genId(),
    name: "",
    kpiTypes: [],
    periods: ["monthly"],
    trigger: "progress_low",
    triggerParams: { progressThresholdPct: 70, minElapsedPct: 50 },
    action: {
      titleTemplate: "",
      priority: "normal",
      dueOffsetDays: 1,
    },
    enabled: true,
  };
}

export function EditPlaybookRuleDialog({
  open,
  onOpenChange,
  initialRule,
  onSave,
}: EditPlaybookRuleDialogProps) {
  const { toast } = useToast();
  const [rule, setRule] = useState<PlaybookRule>(emptyRule());

  useEffect(() => {
    if (!open) return;
    if (initialRule) {
      setRule({ ...initialRule });
    } else {
      setRule(emptyRule());
    }
  }, [open, initialRule]);

  const toggleKpiType = (t: KpiType) => {
    setRule((r) => {
      const set = new Set(r.kpiTypes);
      if (set.has(t)) set.delete(t);
      else set.add(t);
      return { ...r, kpiTypes: Array.from(set) };
    });
  };

  const togglePeriod = (p: KpiPeriod) => {
    setRule((r) => {
      const set = new Set(r.periods);
      if (set.has(p)) set.delete(p);
      else set.add(p);
      return { ...r, periods: Array.from(set) };
    });
  };

  const handleSave = () => {
    if (!rule.name.trim()) {
      toast({ title: "Thiếu tên rule", variant: "error" });
      return;
    }
    if (!rule.action.titleTemplate.trim()) {
      toast({ title: "Thiếu template tiêu đề task", variant: "error" });
      return;
    }
    onSave(rule);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialRule ? "Sửa rule playbook" : "Thêm rule playbook"}
          </DialogTitle>
          <DialogDescription>
            Rule = điều kiện (trigger) + hành động (tạo task). Khi chạy playbook,
            mỗi KPI match rule sẽ tự động sinh 1 task trong ngày (tối đa 1/ngày).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Tên + enabled */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>
                Tên rule <span className="text-destructive">*</span>
              </Label>
              <Input
                value={rule.name}
                onChange={(e) =>
                  setRule((r) => ({ ...r, name: e.target.value }))
                }
                placeholder="VD: Doanh thu tháng chậm — nhắc đẩy promo"
              />
            </div>
            <div className="space-y-1.5 flex flex-col justify-end">
              <Label className="invisible">Enabled</Label>
              <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-surface-container-lowest cursor-pointer">
                <Checkbox
                  checked={rule.enabled}
                  onCheckedChange={(c) =>
                    setRule((r) => ({ ...r, enabled: Boolean(c) }))
                  }
                />
                <span className="text-sm">Đang bật</span>
              </label>
            </div>
          </div>

          {/* Filter KPI type + period */}
          <div className="rounded-xl border border-border bg-surface-container/30 p-3 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Icon name="filter_alt" size={16} className="text-primary" />
              Lọc KPI
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Áp dụng cho loại KPI{" "}
                <span className="text-muted-foreground font-normal">
                  (không chọn = tất cả)
                </span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_KPI_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleKpiType(t)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors press-scale-sm ${
                      rule.kpiTypes.includes(t)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-surface-container-lowest border-border text-muted-foreground hover:bg-surface-container"
                    }`}
                  >
                    {KPI_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Áp dụng cho kỳ{" "}
                <span className="text-muted-foreground font-normal">
                  (không chọn = tất cả)
                </span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePeriod(p)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors press-scale-sm ${
                      rule.periods.includes(p)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-surface-container-lowest border-border text-muted-foreground hover:bg-surface-container"
                    }`}
                  >
                    {KPI_PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Trigger */}
          <div className="rounded-xl border border-border bg-surface-container/30 p-3 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Icon name="bolt" size={16} className="text-primary" />
              Điều kiện kích hoạt (trigger)
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Loại trigger</Label>
              <select
                value={rule.trigger}
                onChange={(e) =>
                  setRule((r) => ({
                    ...r,
                    trigger: e.target.value as PlaybookTriggerType,
                  }))
                }
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {ALL_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {PLAYBOOK_TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {(rule.trigger === "progress_low" ||
              rule.trigger === "progress_high") && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ngưỡng tiến độ (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    value={rule.triggerParams.progressThresholdPct ?? ""}
                    onChange={(e) =>
                      setRule((r) => ({
                        ...r,
                        triggerParams: {
                          ...r.triggerParams,
                          progressThresholdPct: Number(e.target.value),
                        },
                      }))
                    }
                    placeholder={
                      rule.trigger === "progress_low" ? "70" : "100"
                    }
                  />
                </div>
                {rule.trigger === "progress_low" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Kỳ trôi tối thiểu (%)
                      <span className="text-muted-foreground font-normal ml-1">
                        — chỉ cảnh báo khi kỳ đã qua X%
                      </span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={rule.triggerParams.minElapsedPct ?? ""}
                      onChange={(e) =>
                        setRule((r) => ({
                          ...r,
                          triggerParams: {
                            ...r.triggerParams,
                            minElapsedPct: Number(e.target.value),
                          },
                        }))
                      }
                      placeholder="50"
                    />
                  </div>
                )}
              </div>
            )}

            {rule.trigger === "no_activity" && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Số ngày đầu kỳ để cảnh báo khi actual = 0
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={rule.triggerParams.firstNDays ?? ""}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      triggerParams: {
                        ...r.triggerParams,
                        firstNDays: Number(e.target.value),
                      },
                    }))
                  }
                  placeholder="3"
                />
              </div>
            )}

            {rule.trigger === "periodic_review" && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Mỗi bao nhiêu ngày tạo task review
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={rule.triggerParams.everyNDays ?? ""}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      triggerParams: {
                        ...r.triggerParams,
                        everyNDays: Number(e.target.value),
                      },
                    }))
                  }
                  placeholder="7"
                />
              </div>
            )}
          </div>

          {/* Action */}
          <div className="rounded-xl border border-border bg-surface-container/30 p-3 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Icon name="add_task" size={16} className="text-primary" />
              Task tạo ra khi trigger khớp
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Tiêu đề task <span className="text-destructive">*</span>
                <span className="text-muted-foreground font-normal ml-1">
                  — hỗ trợ {"{kpiName}"}, {"{progressPct}"}, {"{actual}"},{" "}
                  {"{target}"}, {"{unit}"}
                </span>
              </Label>
              <Input
                value={rule.action.titleTemplate}
                onChange={(e) =>
                  setRule((r) => ({
                    ...r,
                    action: { ...r.action, titleTemplate: e.target.value },
                  }))
                }
                placeholder="Doanh thu {kpiName} mới đạt {progressPct}% — đẩy promo"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Mô tả (tuỳ chọn)</Label>
              <Textarea
                value={rule.action.descriptionTemplate ?? ""}
                onChange={(e) =>
                  setRule((r) => ({
                    ...r,
                    action: {
                      ...r.action,
                      descriptionTemplate: e.target.value,
                    },
                  }))
                }
                rows={2}
                placeholder="Chi tiết kèm context cho người thực hiện..."
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Độ ưu tiên</Label>
                <select
                  value={rule.action.priority}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      action: {
                        ...r.action,
                        priority: e.target.value as AgentTaskPriority,
                      },
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {ALL_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {AGENT_TASK_PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Giao cho role
                  <span className="text-muted-foreground font-normal ml-1">
                    (tuỳ chọn)
                  </span>
                </Label>
                <Input
                  value={rule.action.assignedToRole ?? ""}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      action: {
                        ...r.action,
                        assignedToRole: e.target.value,
                      },
                    }))
                  }
                  placeholder="manager / cashier / …"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hạn chót (+ngày từ hôm nay)</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={rule.action.dueOffsetDays ?? 0}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      action: {
                        ...r.action,
                        dueOffsetDays: Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSave}>
            <Icon name="save" size={16} className="mr-1.5" />
            {initialRule ? "Cập nhật" : "Thêm rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
