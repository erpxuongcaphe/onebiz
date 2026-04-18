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
  createAgentTask,
  getAgents,
  getBranches,
  getKpiBreakdowns,
} from "@/lib/services";
import {
  AGENT_ROLE_LABELS,
  AGENT_TASK_PRIORITY_LABELS,
  type Agent,
  type AgentTaskPriority,
  type KpiBreakdown,
} from "@/lib/types/ai-agents";
import type { BranchDetail } from "@/lib/services/supabase/branches";

interface CreateAgentTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Nếu truyền, prefill KPI và khoá select KPI lại */
  kpiBreakdown?: KpiBreakdown | null;
  /** Nếu truyền, mặc định ngày task = ngày này (ISO yyyy-mm-dd) */
  defaultDate?: string;
}

const PRIORITY_OPTIONS: AgentTaskPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function CreateAgentTaskDialog({
  open,
  onOpenChange,
  onSuccess,
  kpiBreakdown,
  defaultDate,
}: CreateAgentTaskDialogProps) {
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskDate, setTaskDate] = useState(defaultDate ?? todayISO());
  const [priority, setPriority] = useState<AgentTaskPriority>("normal");
  const [assignedToRole, setAssignedToRole] = useState("");
  const [branchId, setBranchId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [kpiId, setKpiId] = useState(kpiBreakdown?.id ?? "");
  const [targetMetric, setTargetMetric] = useState("");
  const [dueTime, setDueTime] = useState("");

  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kpis, setKpis] = useState<KpiBreakdown[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [b, a, k] = await Promise.all([
          getBranches(),
          getAgents(),
          getKpiBreakdowns(),
        ]);
        setBranches(b);
        setAgents(a);
        setKpis(k);
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
    setTitle("");
    setDescription("");
    setTaskDate(defaultDate ?? todayISO());
    setPriority("normal");
    setAssignedToRole(kpiBreakdown?.ownerRole ?? "");
    setBranchId(kpiBreakdown?.branchId ?? "");
    setAgentId(kpiBreakdown?.sourceAgentId ?? "");
    setKpiId(kpiBreakdown?.id ?? "");
    setTargetMetric("");
    setDueTime("");
  }, [open, kpiBreakdown, defaultDate]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: "Thiếu tiêu đề task", variant: "error" });
      return;
    }
    if (!taskDate) {
      toast({ title: "Thiếu ngày thực hiện", variant: "error" });
      return;
    }

    setSaving(true);
    try {
      await createAgentTask({
        title: title.trim(),
        description: description.trim() || undefined,
        taskDate,
        priority,
        assignedToRole: assignedToRole.trim() || undefined,
        branchId: branchId || undefined,
        agentId: agentId || undefined,
        kpiBreakdownId: kpiId || undefined,
        targetMetric: targetMetric.trim() || undefined,
        dueTime: dueTime.trim() || undefined,
      });
      toast({ title: "Đã tạo task", variant: "success" });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi tạo task",
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
            {kpiBreakdown
              ? `Tạo task cho KPI "${kpiBreakdown.kpiName}"`
              : "Tạo task cho nhân sự"}
          </DialogTitle>
          <DialogDescription>
            Task phân công cho nhân sự theo ngày. Có thể gắn với KPI cha để
            theo dõi đóng góp vào mục tiêu.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Tiêu đề */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tiêu đề <span className="text-destructive">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phục vụ 50 đơn hôm nay"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mô tả</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Hướng dẫn chi tiết, checklist, lưu ý..."
              rows={3}
            />
          </div>

          {/* Ngày + giờ deadline + priority */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Ngày <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Deadline (giờ)</label>
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Độ ưu tiên</label>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as AgentTaskPriority)
                }
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {AGENT_TASK_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Assigned role + branch */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giao cho role</label>
              <Input
                value={assignedToRole}
                onChange={(e) => setAssignedToRole(e.target.value)}
                placeholder="cashier-branch-A / manager / barista"
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

          {/* Target metric */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Chỉ số mục tiêu
              <span className="text-muted-foreground font-normal ml-1">
                (chuỗi mô tả — VD &ldquo;50 đơn&rdquo;, &ldquo;2 triệu
                VND&rdquo;)
              </span>
            </label>
            <Input
              value={targetMetric}
              onChange={(e) => setTargetMetric(e.target.value)}
              placeholder="50 đơn"
            />
          </div>

          {/* Agent + KPI link */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Agent tạo ra</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <option value="">— Không gắn agent —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {AGENT_ROLE_LABELS[a.role] ?? a.role}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">KPI liên kết</label>
              <select
                value={kpiId}
                onChange={(e) => setKpiId(e.target.value)}
                disabled={Boolean(kpiBreakdown)}
                className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60"
              >
                <option value="">— Không gắn KPI —</option>
                {kpis.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.kpiName}
                  </option>
                ))}
              </select>
              {kpiBreakdown && (
                <p className="text-xs text-muted-foreground">
                  Đã khoá vào &ldquo;{kpiBreakdown.kpiName}&rdquo;.
                </p>
              )}
            </div>
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
            Tạo task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
