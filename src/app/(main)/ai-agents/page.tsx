"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import { KpiCard } from "@/app/(main)/phan-tich/_components";
import {
  getAgents,
  getAgentExecutions,
  getAgentTasks,
  getKpiBreakdowns,
  seedDefaultAgents,
  triggerAgent,
  runAllPlaybooks,
} from "@/lib/services";
import {
  AGENT_ROLE_ICONS,
  AGENT_ROLE_LABELS,
  type Agent,
  type AgentExecution,
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
  return new Date(iso).toLocaleDateString("vi-VN");
}

// ────────────────────────────────────────────
// Agent card
// ────────────────────────────────────────────
function AgentCard({
  agent,
  onTrigger,
  triggering,
  lastExec,
}: {
  agent: Agent;
  onTrigger: (agent: Agent) => void;
  triggering: boolean;
  lastExec?: AgentExecution;
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

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-surface-container p-2">
          <div className="text-muted-foreground">Lần chạy gần nhất</div>
          <div className="font-semibold mt-0.5">
            {formatRelative(agent.lastRunAt)}
          </div>
        </div>
        <div className="rounded-lg bg-surface-container p-2">
          <div className="text-muted-foreground">Webhook</div>
          <div
            className={`font-semibold mt-0.5 ${
              webhookConfigured ? "text-status-success" : "text-status-warning"
            }`}
          >
            {webhookConfigured ? "Đã cấu hình" : "Chưa cấu hình"}
          </div>
        </div>
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
          label="Task hôm nay"
          value={String(taskCount)}
          change={`${pendingTaskCount} chưa hoàn thành`}
          positive={pendingTaskCount === 0}
          icon="checklist"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
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
          {/* Agent grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onTrigger={handleTrigger}
                triggering={triggeringId === agent.id}
                lastExec={lastExecByAgent.get(agent.id)}
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
