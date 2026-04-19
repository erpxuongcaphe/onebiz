/**
 * Agent SLA utilities — Sprint AI-3
 *
 * Tính "urgency level" cho task + KPI:
 *   - overdue: task đã quá hạn mà chưa done/skipped
 *   - due_today: task có taskDate/dueTime hôm nay và chưa xong
 *   - due_soon: task sắp tới hạn trong 1-2 ngày tới
 *   - ok: bình thường
 *
 * Dùng để hiển thị badge ở CEO dashboard + agent detail queue.
 */

import type { AgentTask, KpiBreakdown } from "@/lib/types/ai-agents";

// ────────────────────────────────────────────
// Date helpers (LOCAL timezone — không dùng toISOString)
// ────────────────────────────────────────────

function todayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseLocalDate(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      0,
      0,
      0,
      0,
    );
  }
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ────────────────────────────────────────────
// Task urgency
// ────────────────────────────────────────────

export type TaskUrgency = "overdue" | "due_today" | "due_soon" | "ok" | "done";

export function taskUrgency(task: AgentTask): TaskUrgency {
  if (task.status === "done" || task.status === "skipped") return "done";

  const today = todayLocal();
  const taskDate = parseLocalDate(task.taskDate);
  const diffDays = Math.floor(
    (taskDate.getTime() - today.getTime()) / (86400 * 1000),
  );

  // taskDate quá hạn (< hôm nay)
  if (diffDays < 0) return "overdue";

  // taskDate == hôm nay → có thể quá hạn theo dueTime
  if (diffDays === 0) {
    if (task.dueTime) {
      // dueTime format: "HH:MM" hoặc ISO — chỉ check HH:MM
      const timeMatch = task.dueTime.match(/^(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const now = new Date();
        const h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const dueTs = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
          h,
          m,
          0,
          0,
        );
        if (Date.now() > dueTs.getTime()) return "overdue";
      }
    }
    return "due_today";
  }

  // 1-2 ngày tới
  if (diffDays <= 2) return "due_soon";
  return "ok";
}

/** Class Tailwind tương ứng với urgency (badge) */
export const TASK_URGENCY_TONE: Record<TaskUrgency, string> = {
  overdue: "bg-status-error/10 text-status-error",
  due_today: "bg-status-warning/10 text-status-warning",
  due_soon: "bg-status-info/10 text-status-info",
  ok: "bg-surface-container-high text-muted-foreground",
  done: "bg-status-success/10 text-status-success",
};

export const TASK_URGENCY_LABELS: Record<TaskUrgency, string> = {
  overdue: "Quá hạn",
  due_today: "Hôm nay",
  due_soon: "Sắp tới",
  ok: "Còn hạn",
  done: "Đã xong",
};

export const TASK_URGENCY_ICON: Record<TaskUrgency, string> = {
  overdue: "error",
  due_today: "schedule",
  due_soon: "hourglass_bottom",
  ok: "event",
  done: "check_circle",
};

// ────────────────────────────────────────────
// Agent workload summary
// ────────────────────────────────────────────

export interface AgentWorkload {
  agentId: string;
  pending: number;
  inProgress: number;
  done: number;
  blocked: number;
  overdue: number;
  dueToday: number;
  /** Tổng task đang active (pending + in_progress) */
  activeCount: number;
}

export function summarizeWorkload(
  agentId: string,
  tasks: AgentTask[],
): AgentWorkload {
  const agentTasks = tasks.filter((t) => t.agentId === agentId);
  let pending = 0,
    inProgress = 0,
    done = 0,
    blocked = 0,
    overdue = 0,
    dueToday = 0;

  for (const t of agentTasks) {
    switch (t.status) {
      case "pending":
        pending += 1;
        break;
      case "in_progress":
        inProgress += 1;
        break;
      case "done":
        done += 1;
        break;
      case "blocked":
        blocked += 1;
        break;
    }
    const u = taskUrgency(t);
    if (u === "overdue") overdue += 1;
    else if (u === "due_today") dueToday += 1;
  }

  return {
    agentId,
    pending,
    inProgress,
    done,
    blocked,
    overdue,
    dueToday,
    activeCount: pending + inProgress,
  };
}

// ────────────────────────────────────────────
// KPI progress summary per agent
// ────────────────────────────────────────────

export interface AgentKpiSummary {
  agentId: string;
  kpiCount: number;
  /** Avg progressPct (actual/target × 100), làm tròn 1 decimal */
  avgProgress: number;
  /** Số KPI có progress < 70% (đang chậm) */
  laggingCount: number;
  /** Số KPI đã vượt 100% */
  overAchievedCount: number;
}

export function summarizeKpiForAgent(
  agentId: string,
  kpis: KpiBreakdown[],
): AgentKpiSummary {
  const ownKpis = kpis.filter((k) => k.sourceAgentId === agentId);
  if (ownKpis.length === 0) {
    return {
      agentId,
      kpiCount: 0,
      avgProgress: 0,
      laggingCount: 0,
      overAchievedCount: 0,
    };
  }

  let sumProgress = 0;
  let lag = 0,
    over = 0;
  for (const k of ownKpis) {
    const p = k.targetValue > 0 ? (k.actualValue / k.targetValue) * 100 : 0;
    sumProgress += p;
    if (p < 70) lag += 1;
    if (p >= 100) over += 1;
  }

  return {
    agentId,
    kpiCount: ownKpis.length,
    avgProgress: Math.round((sumProgress / ownKpis.length) * 10) / 10,
    laggingCount: lag,
    overAchievedCount: over,
  };
}
