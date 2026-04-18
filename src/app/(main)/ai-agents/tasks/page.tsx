"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import {
  getAgentTasks,
  updateAgentTaskStatus,
} from "@/lib/services";
import {
  AGENT_TASK_PRIORITY_LABELS,
  AGENT_TASK_STATUS_LABELS,
  AGENT_TASK_STATUS_TONE,
  type AgentTask,
  type AgentTaskStatus,
} from "@/lib/types/ai-agents";
import { useToast } from "@/lib/contexts";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-surface-container-high text-muted-foreground",
  info: "bg-status-info/10 text-status-info",
  success: "bg-status-success/10 text-status-success",
  warning: "bg-status-warning/10 text-status-warning",
  error: "bg-status-error/10 text-status-error",
};

const PRIORITY_TONE: Record<AgentTask["priority"], string> = {
  low: "bg-surface-container-high text-muted-foreground",
  normal: "bg-status-info/10 text-status-info",
  high: "bg-status-warning/10 text-status-warning",
  urgent: "bg-status-error/10 text-status-error",
};

const STATUS_ICONS: Record<AgentTaskStatus, string> = {
  pending: "schedule",
  in_progress: "progress_activity",
  done: "check_circle",
  skipped: "skip_next",
  blocked: "block",
};

const STATUS_FILTERS: Array<{ key: AgentTaskStatus | "all"; label: string }> = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chờ" },
  { key: "in_progress", label: "Đang làm" },
  { key: "done", label: "Hoàn thành" },
  { key: "blocked", label: "Tắc nghẽn" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

function TaskRow({
  task,
  onChangeStatus,
  busy,
}: {
  task: AgentTask;
  onChangeStatus: (id: string, status: AgentTaskStatus) => void;
  busy: boolean;
}) {
  const tone = AGENT_TASK_STATUS_TONE[task.status];
  const nextStatus: AgentTaskStatus | null =
    task.status === "pending"
      ? "in_progress"
      : task.status === "in_progress"
        ? "done"
        : null;

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-border ambient-shadow p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{task.title}</span>
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${TONE_CLASS[tone]}`}
            >
              <Icon
                name={STATUS_ICONS[task.status]}
                size={10}
                className="inline-block mr-0.5"
              />
              {AGENT_TASK_STATUS_LABELS[task.status]}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${PRIORITY_TONE[task.priority]}`}
            >
              {AGENT_TASK_PRIORITY_LABELS[task.priority]}
            </span>
          </div>
          {task.description && (
            <p className="text-sm text-foreground/80 mt-1">{task.description}</p>
          )}
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>
              <Icon name="event" size={12} className="inline-block mr-0.5" />
              {formatDate(task.taskDate)}
            </span>
            {task.dueTime && (
              <span>
                <Icon
                  name="schedule"
                  size={12}
                  className="inline-block mr-0.5"
                />
                {task.dueTime}
              </span>
            )}
            {task.assignedToRole && (
              <span>
                <Icon
                  name="person"
                  size={12}
                  className="inline-block mr-0.5"
                />
                {task.assignedToRole}
              </span>
            )}
            {task.targetMetric && (
              <span>
                <Icon name="flag" size={12} className="inline-block mr-0.5" />
                {task.targetMetric}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {nextStatus && (
          <Button
            size="sm"
            variant="default"
            disabled={busy}
            onClick={() => onChangeStatus(task.id, nextStatus)}
          >
            <Icon
              name={nextStatus === "done" ? "check" : "play_arrow"}
              size={14}
            />
            <span className="ml-1">
              {nextStatus === "done" ? "Đánh dấu hoàn thành" : "Bắt đầu"}
            </span>
          </Button>
        )}
        {task.status !== "blocked" && task.status !== "done" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onChangeStatus(task.id, "blocked")}
          >
            <Icon name="block" size={14} />
            <span className="ml-1">Tắc nghẽn</span>
          </Button>
        )}
        {task.status !== "skipped" && task.status !== "done" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onChangeStatus(task.id, "skipped")}
          >
            <Icon name="skip_next" size={14} />
            <span className="ml-1">Bỏ qua</span>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AgentTasksPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [filter, setFilter] = useState<AgentTaskStatus | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAgentTasks();
      setTasks(data);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi tải task",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleChangeStatus = async (id: string, status: AgentTaskStatus) => {
    setBusyId(id);
    try {
      await updateAgentTaskStatus(id, status);
      toast({ title: "Đã cập nhật trạng thái", variant: "success" });
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi cập nhật",
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );

  const counts = useMemo((): Record<string, number> => {
    const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    }, {});
    return { total: tasks.length, ...byStatus };
  }, [tasks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon
          name="progress_activity"
          size={32}
          className="animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Task hàng ngày"
        actions={[
          {
            label: "Về AI Agents",
            icon: <Icon name="arrow_back" size={16} />,
            variant: "outline",
            href: "/ai-agents",
          },
        ]}
      />

      <p className="text-sm text-muted-foreground px-1">
        Task do AI Agent phân công cho nhân sự từng ngày dựa trên KPI.
      </p>

      {/* Filter pills */}
      <div className="flex items-center gap-2 overflow-x-auto">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${
              filter === f.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"
            }`}
          >
            {f.label}
            <span className="ml-1 opacity-70">
              ({f.key === "all" ? counts.total : (counts[f.key] ?? 0)})
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-10 text-center">
          <div className="mx-auto size-16 rounded-full bg-status-warning/10 flex items-center justify-center mb-4">
            <Icon name="checklist" size={32} className="text-status-warning" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            {filter === "all" ? "Chưa có task nào" : "Không có task ở trạng thái này"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            AI Agent HR sẽ tự tạo task từ KPI. Bạn cũng có thể POST qua
            webhook <code className="font-mono">/api/ai-agent/task</code>.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onChangeStatus={handleChangeStatus}
              busy={busyId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
