"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import { KpiCard } from "@/app/(main)/phan-tich/_components";
import { formatShortDate } from "@/lib/format";
import {
  getAgents,
  getAgentExecutions,
  getAgentTasks,
  getKpiBreakdowns,
  seedDefaultAgents,
  triggerAgent,
  runAllPlaybooks,
  summarizeWorkload,
  summarizeKpiForAgent,
  taskUrgency,
  TASK_URGENCY_LABELS,
  TASK_URGENCY_TONE,
  TASK_URGENCY_ICON,
  type AgentWorkload,
  type AgentKpiSummary,
} from "@/lib/services";
import {
  AGENT_ROLE_ICONS,
  AGENT_ROLE_LABELS,
  AGENT_TASK_PRIORITY_LABELS,
  type Agent,
  type AgentExecution,
  type AgentTask,
  type KpiBreakdown,
} from "@/lib/types/ai-agents";
import { useToast } from "@/lib/contexts";
import type { ToastVariant } from "@/lib/contexts/toast-context";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────
function formatRelative(iso?: string | null): string {
  if (!iso) return "Chưa chạy";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return formatShortDate(iso);
}

// ────────────────────────────────────────────
// Agent card
// ────────────────────────────────────────────
function AgentCard({
  agent,
  onTrigger,
  triggering,
  lastExec,
  workload,
  kpiSummary,
}: {
  agent: Agent;
  onTrigger: (agent: Agent) => void;
  triggering: boolean;
  lastExec?: AgentExecution;
  workload: AgentWorkload;
  kpiSummary: AgentKpiSummary;
}) {
  const iconName = AGENT_ROLE_ICONS[agent.role] ?? "smart_toy";
  const roleLabel = AGENT_ROLE_LABELS[agent.role] ?? agent.name;

  const statusTone =
    !agent.isActive
      ? "neutral"
      : lastExec?.status === "failed" || lastExec?.status === "timeout"
        ? "error"
        : lastExec?.status === "running"
          ? "info"
          : "success";

  const statusClass: Record<string, string> = {
    success: "bg-status-success/10 text-status-success",
    info: "bg-status-info/10 text-status-info",
    error: "bg-status-error/10 text-status-error",
    neutral: "bg-surface-container-high text-muted-foreground",
  };

  const webhookConfigured = Boolean(agent.n8nWebhookUrl);

  return (
    <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-5 flex flex-col gap-4 border border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 rounded-xl bg-primary-fixed flex items-center justify-center shrink-0">
            <Icon name={iconName} size={24} className="text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{agent.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {roleLabel}
            </div>
          </div>
        </div>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${statusClass[statusTone]}`}
        >
          {agent.isActive ? "Hoạt động" : "Tạm ngưng"}
        </span>
      </div>

      {agent.description && (
        <p className="text-sm text-foreground/80 line-clamp-2 min-h-10">
          {agent.description}
        </p>
      )}

      {/* Workload + KPI (Sprint AI-3) */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div
          className={`rounded-lg p-2 ${
            workload.overdue > 0
              ? "bg-status-error/10"
              : workload.activeCount > 0
                ? "bg-status-info/10"
                : "bg-surface-container"
          }`}
        >
          <div className="text-muted-foreground flex items-center gap-1">
            <Icon name="task_alt" size={12} />
            Task đang làm
          </div>
          <div className="font-semibold mt-0.5 flex items-baseline gap-1">
            <span>{workload.activeCount}</span>
            {workload.overdue > 0 && (
              <span className="text-[10px] font-semibold text-status-error">
                · {workload.overdue} quá hạn
              </span>
            )}
            {workload.dueToday > 0 && workload.overdue === 0 && (
              <span className="text-[10px] font-semibold text-status-warning">
                · {workload.dueToday} hôm nay
              </span>
            )}
          </div>
        </div>
        <div
          className={`rounded-lg p-2 ${
            kpiSummary.kpiCount === 0
              ? "bg-surface-container"
              : kpiSummary.avgProgress >= 100
                ? "bg-status-success/10"
                : kpiSummary.avgProgress < 70
                  ? "bg-status-warning/10"
                  : "bg-status-info/10"
          }`}
        >
          <div className="text-muted-foreground flex items-center gap-1">
            <Icon name="trending_up" size={12} />
            KPI tiến độ
          </div>
          <div className="font-semibold mt-0.5">
            {kpiSummary.kpiCount > 0
              ? `${kpiSummary.avgProgress.toFixed(1)}% (${kpiSummary.kpiCount} KPI)`
              : "Chưa gán KPI"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          <Icon name="history" size={11} className="inline-block mr-0.5" />
          {formatRelative(agent.lastRunAt)}
        </span>
        <span
          className={
            webhookConfigured ? "text-status-success" : "text-status-warning"
          }
        >
          <Icon
            name={webhookConfigured ? "check_circle" : "warning"}
            size={11}
            className="inline-block mr-0.5"
          />
          {webhookConfigured ? "Webhook OK" : "Chưa có webhook"}
        </span>
      </div>

      <div className="flex gap-2 mt-auto">
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          disabled={!webhookConfigured || !agent.isActive || triggering}
          onClick={() => onTrigger(agent)}
        >
          <Icon
            name={triggering ? "progress_activity" : "play_arrow"}
            size={16}
            className={triggering ? "animate-spin" : ""}
          />
          <span className="ml-1">{triggering ? "Đang chạy" : "Chạy thử"}</span>
        </Button>
        <Link href={`/ai-agents/${agent.id}`}>
          <Button variant="outline" size="sm">
            <Icon name="settings" size={16} />
            <span className="ml-1">Cấu hình</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────
// Page
// ────────────────────────────────────────────
export default function AiAgentsPage() {
  const { toast } = useToast();
  const notify = (title: string, variant: ToastVariant = "default") =>
    toast({ title, variant });
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [kpiCount, setKpiCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  const [allTasks, setAllTasks] = useState<AgentTask[]>([]);
  const [allKpis, setAllKpis] = useState<KpiBreakdown[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, execs, kpis, tasks] = await Promise.all([
        getAgents(),
        getAgentExecutions({ limit: 20 }),
        getKpiBreakdowns(),
        getAgentTasks(),
      ]);
      setAgents(rows);
      setExecutions(execs);
      setAllTasks(tasks);
      setAllKpis(kpis);
      setKpiCount(kpis.length);
      setTaskCount(tasks.length);
      setPendingTaskCount(
        tasks.filter((t) => t.status === "pending" || t.status === "in_progress")
          .length,
      );
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi tải AI Agents",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedDefaultAgents();
      notify("Đã tạo 6 agent mặc định", "success");
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi tạo agent", "error");
    } finally {
      setSeeding(false);
    }
  };

  const handleRunAllPlaybooks = async () => {
    setRunningAll(true);
    try {
      const results = await runAllPlaybooks();
      if (results.length === 0) {
        notify("Không có agent nào có playbook đang bật", "warning");
        return;
      }
      const totalCreated = results.reduce((s, r) => s + r.tasksCreated, 0);
      const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
      const totalScanned = results.reduce((s, r) => s + r.kpisScanned, 0);
      notify(
        `Đã tạo ${totalCreated} task từ ${results.length} agent · bỏ qua ${totalSkipped} · quét ${totalScanned} KPI`,
        totalCreated > 0 ? "success" : "default",
      );
      await loadData();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Lỗi chạy playbook",
        "error",
      );
    } finally {
      setRunningAll(false);
    }
  };

  const handleTrigger = async (agent: Agent) => {
    setTriggeringId(agent.id);
    try {
      await triggerAgent(agent.id, {
        triggered_from: "ui",
        triggered_at: new Date().toISOString(),
      });
      notify(`Đã gọi ${agent.name}`, "success");
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi trigger agent", "error");
    } finally {
      setTriggeringId(null);
    }
  };

  const lastExecByAgent = useMemo(() => {
    const map = new Map<string, AgentExecution>();
    for (const ex of executions) {
      if (!map.has(ex.agentId)) map.set(ex.agentId, ex);
    }
    return map;
  }, [executions]);

  // Workload + KPI summary per agent (Sprint AI-3)
  const workloadByAgent = useMemo(() => {
    const m = new Map<string, AgentWorkload>();
    for (const a of agents) m.set(a.id, summarizeWorkload(a.id, allTasks));
    return m;
  }, [agents, allTasks]);

  const kpiSummaryByAgent = useMemo(() => {
    const m = new Map<string, AgentKpiSummary>();
    for (const a of agents) m.set(a.id, summarizeKpiForAgent(a.id, allKpis));
    return m;
  }, [agents, allKpis]);

  // Critical tasks: overdue or urgent pending across all agents
  const criticalTasks = useMemo(() => {
    return allTasks
      .filter((t) => {
        const u = taskUrgency(t);
        return u === "overdue" || (u === "due_today" && t.priority === "urgent");
      })
      .sort((a, b) => {
        // overdue first, then by taskDate asc (oldest first)
        const ua = taskUrgency(a);
        const ub = taskUrgency(b);
        if (ua !== ub) return ua === "overdue" ? -1 : 1;
        return a.taskDate.localeCompare(b.taskDate);
      })
      .slice(0, 8);
  }, [allTasks]);

  const totalOverdueCount = useMemo(
    () => allTasks.filter((t) => taskUrgency(t) === "overdue").length,
    [allTasks],
  );
  const totalDueTodayCount = useMemo(
    () => allTasks.filter((t) => taskUrgency(t) === "due_today").length,
    [allTasks],
  );

  const activeCount = agents.filter((a) => a.isActive).length;
  const configuredCount = agents.filter(
    (a) => a.isActive && a.n8nWebhookUrl,
  ).length;
  const last24hRunCount = executions.filter((ex) => {
    const diff = Date.now() - new Date(ex.triggeredAt).getTime();
    return diff < 24 * 60 * 60 * 1000;
  }).length;

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
    <div className="space-y-6">
      <PageHeader
        title="AI Agents"
        actions={[
          ...(agents.length === 0
            ? [
                {
                  label: seeding ? "Đang tạo..." : "Tạo 6 agent mặc định",
                  icon: (
                    <Icon
                      name={seeding ? "progress_activity" : "auto_awesome"}
                      size={16}
                      className={seeding ? "animate-spin" : ""}
                    />
                  ),
                  variant: "default" as const,
                  onClick: handleSeed,
                },
              ]
            : []),
          {
            label: "KPI Breakdown",
            icon: <Icon name="trending_up" size={16} />,
            variant: "outline" as const,
            href: "/ai-agents/kpi",
          },
          {
            label: "Task hàng ngày",
            icon: <Icon name="checklist" size={16} />,
            variant: "outline" as const,
            href: "/ai-agents/tasks",
          },
          ...(agents.length > 0
            ? [
                {
                  label: runningAll
                    ? "Đang chạy playbook..."
                    : "Chạy tất cả playbook",
                  icon: (
                    <Icon
                      name={runningAll ? "progress_activity" : "play_circle"}
                      size={16}
                      className={runningAll ? "animate-spin" : ""}
                    />
                  ),
                  variant: "default" as const,
                  onClick: handleRunAllPlaybooks,
                  disabled: runningAll,
                },
              ]
            : []),
        ]}
      />
      <p className="text-sm text-muted-foreground px-1">
        Hệ thống AI Agent tự động hoá vận hành doanh nghiệp — tích hợp n8n.io.
      </p>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Agent đang hoạt động"
          value={`${activeCount}/${agents.length}`}
          change={`${configuredCount} đã có webhook`}
          positive={configuredCount === activeCount && activeCount > 0}
          icon="smart_toy"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard
          label="Lần chạy 24h"
          value={String(last24hRunCount)}
          change={`Tổng log: ${executions.length}`}
          positive
          icon="history"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-status-info"
        />
        <KpiCard
          label="KPI đang theo dõi"
          value={String(kpiCount)}
          change="Bao gồm tất cả kỳ"
          positive
          icon="trending_up"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="Task cần xử lý"
          value={String(totalOverdueCount + totalDueTodayCount)}
          change={
            totalOverdueCount > 0
              ? `${totalOverdueCount} quá hạn · ${totalDueTodayCount} hôm nay`
              : totalDueTodayCount > 0
                ? `${totalDueTodayCount} phải xong hôm nay`
                : `${taskCount} total · ${pendingTaskCount} đang làm`
          }
          positive={totalOverdueCount === 0}
          icon={totalOverdueCount > 0 ? "crisis_alert" : "checklist"}
          bg={
            totalOverdueCount > 0 ? "bg-status-error/10" : "bg-status-warning/10"
          }
          iconColor={
            totalOverdueCount > 0 ? "text-status-error" : "text-status-warning"
          }
          valueColor={
            totalOverdueCount > 0 ? "text-status-error" : "text-status-warning"
          }
        />
      </div>

      {/* Empty state */}
      {agents.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-10 text-center">
          <div className="mx-auto size-16 rounded-full bg-primary-fixed flex items-center justify-center mb-4">
            <Icon name="auto_awesome" size={32} className="text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            Chưa có agent nào
          </h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Hệ thống AI Agent gồm 6 vai trò mặc định: CEO, HR, Marketing,
            Sales, Operations, Finance. Mỗi agent nhận input từ doanh nghiệp
            → break down KPI → tạo task hàng ngày.
          </p>
          <Button onClick={handleSeed} disabled={seeding}>
            <Icon
              name={seeding ? "progress_activity" : "auto_awesome"}
              size={16}
              className={seeding ? "animate-spin" : ""}
            />
            <span className="ml-1">
              {seeding ? "Đang tạo..." : "Tạo 6 agent mặc định"}
            </span>
          </Button>
        </div>
      ) : (
        <>
          {/* Critical tasks banner (Sprint AI-3) */}
          {criticalTasks.length > 0 && (
            <div className="bg-status-error/5 border border-status-error/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icon
                  name="crisis_alert"
                  size={18}
                  className="text-status-error"
                />
                <h3 className="font-semibold text-status-error">
                  Task cần xử lý gấp
                </h3>
                <span className="text-xs text-muted-foreground">
                  ({totalOverdueCount} quá hạn · {totalDueTodayCount} hôm nay)
                </span>
              </div>
              <ul className="space-y-1.5">
                {criticalTasks.map((t) => {
                  const u = taskUrgency(t);
                  const agent = agents.find((a) => a.id === t.agentId);
                  return (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 text-sm bg-surface-container-lowest rounded-lg px-3 py-2"
                    >
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 shrink-0 ${TASK_URGENCY_TONE[u]}`}
                      >
                        <Icon
                          name={TASK_URGENCY_ICON[u]}
                          size={10}
                          className="inline-block mr-0.5"
                        />
                        {TASK_URGENCY_LABELS[u]}
                      </span>
                      <span className="font-medium truncate flex-1">
                        {t.title}
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {agent?.name ?? "—"}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 shrink-0 ${
                          t.priority === "urgent"
                            ? "bg-status-error/10 text-status-error"
                            : t.priority === "high"
                              ? "bg-status-warning/10 text-status-warning"
                              : "bg-status-info/10 text-status-info"
                        }`}
                      >
                        {AGENT_TASK_PRIORITY_LABELS[t.priority]}
                      </span>
                      {agent && (
                        <Link
                          href={`/ai-agents/${agent.id}`}
                          className="text-xs text-primary hover:underline shrink-0"
                        >
                          Xem →
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              {totalOverdueCount + totalDueTodayCount > criticalTasks.length && (
                <p className="text-xs text-muted-foreground mt-2">
                  Còn{" "}
                  {totalOverdueCount + totalDueTodayCount - criticalTasks.length}{" "}
                  task nữa —{" "}
                  <Link
                    href="/ai-agents/tasks"
                    className="text-primary hover:underline"
                  >
                    xem tất cả
                  </Link>
                </p>
              )}
            </div>
          )}

          {/* Agent grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onTrigger={handleTrigger}
                triggering={triggeringId === agent.id}
                lastExec={lastExecByAgent.get(agent.id)}
                workload={
                  workloadByAgent.get(agent.id) ?? {
                    agentId: agent.id,
                    pending: 0,
                    inProgress: 0,
                    done: 0,
                    blocked: 0,
                    overdue: 0,
                    dueToday: 0,
                    activeCount: 0,
                  }
                }
                kpiSummary={
                  kpiSummaryByAgent.get(agent.id) ?? {
                    agentId: agent.id,
                    kpiCount: 0,
                    avgProgress: 0,
                    laggingCount: 0,
                    overAchievedCount: 0,
                  }
                }
              />
            ))}
          </div>

          {/* Recent executions */}
          {executions.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Log chạy gần đây</h3>
                <span className="text-xs text-muted-foreground">
                  {executions.length} lần gần nhất
                </span>
              </div>
              <div className="divide-y divide-border">
                {executions.slice(0, 10).map((ex) => {
                  const agent = agents.find((a) => a.id === ex.agentId);
                  const statusTone =
                    ex.status === "success"
                      ? "success"
                      : ex.status === "running"
                        ? "info"
                        : "error";
                  const statusClass: Record<string, string> = {
                    success: "bg-status-success/10 text-status-success",
                    info: "bg-status-info/10 text-status-info",
                    error: "bg-status-error/10 text-status-error",
                  };
                  return (
                    <div
                      key={ex.id}
                      className="flex items-center gap-3 py-2.5 text-sm"
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ${statusClass[statusTone]}`}
                      >
                        {ex.status}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {agent?.name ?? "Agent đã xoá"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {ex.triggerSource} · {formatRelative(ex.triggeredAt)}
                          {ex.durationMs != null && ` · ${ex.durationMs}ms`}
                        </div>
                      </div>
                      {ex.errorMessage && (
                        <span className="text-xs text-status-error truncate max-w-[200px]">
                          {ex.errorMessage}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
