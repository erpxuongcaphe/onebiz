"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { EditPlaybookRuleDialog } from "@/components/shared/dialogs/edit-playbook-rule-dialog";
import {
  deleteAgent,
  getAgentById,
  getAgentExecutions,
  getAgentTasks,
  triggerAgent,
  updateAgent,
  updateAgentTask,
  updateAgentTaskStatus,
  getPlaybookRules,
  savePlaybookRules,
  runPlaybookForAgent,
  defaultPlaybookForRole,
  summarizeWorkload,
  taskUrgency,
  TASK_URGENCY_ICON,
  TASK_URGENCY_LABELS,
  TASK_URGENCY_TONE,
} from "@/lib/services";
import {
  AGENT_EXECUTION_STATUS_LABELS,
  AGENT_ROLE_ICONS,
  AGENT_ROLE_LABELS,
  AGENT_TASK_PRIORITY_LABELS,
  AGENT_TASK_STATUS_LABELS,
  AGENT_TASK_STATUS_TONE,
  KPI_PERIOD_LABELS,
  KPI_TYPE_LABELS,
  PLAYBOOK_TRIGGER_LABELS,
  type Agent,
  type AgentExecution,
  type AgentRole,
  type AgentTask,
  type AgentTaskPriority,
  type AgentTaskStatus,
  type PlaybookRule,
} from "@/lib/types/ai-agents";
import { useToast } from "@/lib/contexts";
import type { ToastVariant } from "@/lib/contexts/toast-context";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────
function formatRelative(iso?: string | null): string {
  if (!iso) return "—";
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

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}

const ROLE_OPTIONS: AgentRole[] = [
  "ceo",
  "hr",
  "marketing",
  "sales",
  "operations",
  "finance",
  "custom",
];

const EXEC_STATUS_TONE: Record<string, string> = {
  success: "bg-status-success/10 text-status-success",
  running: "bg-status-info/10 text-status-info",
  failed: "bg-status-error/10 text-status-error",
  timeout: "bg-status-warning/10 text-status-warning",
};

// ────────────────────────────────────────────
// Execution detail card
// ────────────────────────────────────────────
function ExecutionCard({ execution }: { execution: AgentExecution }) {
  const [open, setOpen] = useState(false);
  const tone = EXEC_STATUS_TONE[execution.status] ?? EXEC_STATUS_TONE.running;
  const statusLabel = AGENT_EXECUTION_STATUS_LABELS[execution.status];

  const hasPayload =
    Object.keys(execution.inputData).length > 0 ||
    Object.keys(execution.outputData).length > 0 ||
    execution.errorMessage;

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-border p-3">
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => hasPayload && setOpen((o) => !o)}
      >
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${tone}`}
        >
          {statusLabel}
        </span>
        <div className="flex-1 min-w-0 text-sm">
          <div className="font-medium">
            {execution.triggerSource === "n8n"
              ? "n8n Webhook"
              : execution.triggerSource === "manual"
                ? "Chạy thủ công"
                : "Cron"}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDateTime(execution.triggeredAt)}
            {execution.durationMs != null && ` · ${execution.durationMs}ms`}
          </div>
        </div>
        {execution.errorMessage && !open && (
          <span className="text-xs text-status-error truncate max-w-[240px] hidden sm:inline">
            {execution.errorMessage}
          </span>
        )}
        {hasPayload && (
          <Icon
            name={open ? "expand_less" : "expand_more"}
            size={18}
            className="text-muted-foreground shrink-0"
          />
        )}
      </div>
      {open && hasPayload && (
        <div className="mt-3 space-y-2 text-xs">
          {execution.errorMessage && (
            <div className="rounded-lg bg-status-error/5 border border-status-error/20 p-2.5">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-status-error mb-1">
                Lỗi
              </div>
              <div className="text-status-error font-mono whitespace-pre-wrap break-words">
                {execution.errorMessage}
              </div>
            </div>
          )}
          {Object.keys(execution.inputData).length > 0 && (
            <div className="rounded-lg bg-surface-container p-2.5">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                Input
              </div>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-words max-h-48 overflow-auto">
                {JSON.stringify(execution.inputData, null, 2)}
              </pre>
            </div>
          )}
          {Object.keys(execution.outputData).length > 0 && (
            <div className="rounded-lg bg-surface-container p-2.5">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                Output
              </div>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-words max-h-48 overflow-auto">
                {JSON.stringify(execution.outputData, null, 2)}
              </pre>
            </div>
          )}
          {execution.tokenUsage && (
            <div className="rounded-lg bg-primary-fixed/40 p-2.5 text-primary">
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-1">
                Token usage
              </div>
              <div className="flex gap-3 font-mono">
                <span>prompt: {execution.tokenUsage.prompt_tokens ?? 0}</span>
                <span>
                  completion: {execution.tokenUsage.completion_tokens ?? 0}
                </span>
                <span>total: {execution.tokenUsage.total_tokens ?? 0}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Page
// ────────────────────────────────────────────
export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const notify = (title: string, variant: ToastVariant = "default") =>
    toast({ title, variant });

  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<
    "active" | "overdue" | "all"
  >("active");

  // Form state
  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("custom");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [configJson, setConfigJson] = useState("{}");
  const [isActive, setIsActive] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Actions state
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Playbook state (Sprint AI-2)
  const [playbookRules, setPlaybookRules] = useState<PlaybookRule[]>([]);
  const [playbookDialogOpen, setPlaybookDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PlaybookRule | null>(null);
  const [runningPlaybook, setRunningPlaybook] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    try {
      const [a, execs, taskRows] = await Promise.all([
        getAgentById(params.id),
        getAgentExecutions({ agentId: params.id, limit: 20 }),
        getAgentTasks({ agentId: params.id }),
      ]);
      if (!a) {
        notify("Không tìm thấy agent", "error");
        router.push("/ai-agents");
        return;
      }
      setAgent(a);
      setExecutions(execs);
      setTasks(taskRows);
      setName(a.name);
      setRole(a.role);
      setDescription(a.description ?? "");
      setWebhookUrl(a.n8nWebhookUrl ?? "");
      setWorkflowId(a.n8nWorkflowId ?? "");
      setPromptTemplate(a.promptTemplate ?? "");
      setConfigJson(JSON.stringify(a.config ?? {}, null, 2));
      setIsActive(a.isActive);
      setPlaybookRules(getPlaybookRules(a));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi tải agent", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConfigChange = (v: string) => {
    setConfigJson(v);
    if (!v.trim()) {
      setConfigError(null);
      return;
    }
    try {
      JSON.parse(v);
      setConfigError(null);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const handleSave = async () => {
    if (!agent) return;

    let parsedConfig: Record<string, unknown> = {};
    if (configJson.trim()) {
      try {
        parsedConfig = JSON.parse(configJson);
      } catch (err) {
        notify(
          `Config JSON không hợp lệ: ${
            err instanceof Error ? err.message : "parse error"
          }`,
          "error",
        );
        return;
      }
    }

    if (!name.trim()) {
      notify("Thiếu tên agent", "error");
      return;
    }

    setSaving(true);
    try {
      await updateAgent({
        id: agent.id,
        name: name.trim(),
        role,
        description: description.trim() || undefined,
        promptTemplate: promptTemplate.trim() || undefined,
        n8nWebhookUrl: webhookUrl.trim() || undefined,
        n8nWorkflowId: workflowId.trim() || undefined,
        config: parsedConfig,
        isActive,
      });
      notify("Đã lưu cấu hình agent", "success");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi lưu", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    if (!agent) return;
    setTriggering(true);
    try {
      await triggerAgent(agent.id, {
        triggered_from: "ui_detail",
        triggered_at: new Date().toISOString(),
      });
      notify(`Đã gọi ${agent.name}`, "success");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi trigger", "error");
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    setDeleting(true);
    try {
      await deleteAgent(agent.id);
      notify("Đã xoá agent", "success");
      router.push("/ai-agents");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi xoá", "error");
      setDeleting(false);
    }
  };

  // ─── Task intervene handlers (Sprint AI-3) ───
  const handleTaskStatusChange = async (
    taskId: string,
    status: AgentTaskStatus,
  ) => {
    setTaskBusyId(taskId);
    try {
      await updateAgentTaskStatus(taskId, status);
      notify("Đã cập nhật trạng thái task", "success");
      await load();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Lỗi cập nhật task",
        "error",
      );
    } finally {
      setTaskBusyId(null);
    }
  };

  const handleTaskPriorityChange = async (
    taskId: string,
    priority: AgentTaskPriority,
  ) => {
    setTaskBusyId(taskId);
    try {
      await updateAgentTask(taskId, { priority });
      notify(`Đã đổi priority → ${AGENT_TASK_PRIORITY_LABELS[priority]}`, "success");
      await load();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Lỗi đổi priority",
        "error",
      );
    } finally {
      setTaskBusyId(null);
    }
  };

  const handleTaskReassignRole = async (taskId: string) => {
    const current = tasks.find((t) => t.id === taskId)?.assignedToRole ?? "";
    const next = window.prompt(
      "Gán task cho role nào? (để trống = bỏ gán)",
      current,
    );
    if (next === null) return; // user cancelled
    setTaskBusyId(taskId);
    try {
      await updateAgentTask(taskId, {
        assignedToRole: next.trim() || null,
      });
      notify(
        next.trim() ? `Đã gán cho role ${next.trim()}` : "Đã bỏ gán role",
        "success",
      );
      await load();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Lỗi reassign",
        "error",
      );
    } finally {
      setTaskBusyId(null);
    }
  };

  // ─── Playbook handlers (Sprint AI-2) ───
  const persistRules = async (nextRules: PlaybookRule[]) => {
    if (!agent) return;
    setSavingRules(true);
    try {
      await savePlaybookRules(agent.id, nextRules);
      setPlaybookRules(nextRules);
      // Cập nhật lại configJson trong form để đồng bộ với playbook vừa lưu
      setConfigJson(
        JSON.stringify(
          { ...(agent.config ?? {}), playbook: nextRules },
          null,
          2,
        ),
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi lưu rule", "error");
      throw err;
    } finally {
      setSavingRules(false);
    }
  };

  const handleOpenAddRule = () => {
    setEditingRule(null);
    setPlaybookDialogOpen(true);
  };

  const handleOpenEditRule = (rule: PlaybookRule) => {
    setEditingRule(rule);
    setPlaybookDialogOpen(true);
  };

  const handleSaveRule = async (rule: PlaybookRule) => {
    const existingIdx = playbookRules.findIndex((r) => r.id === rule.id);
    const next =
      existingIdx >= 0
        ? playbookRules.map((r, i) => (i === existingIdx ? rule : r))
        : [...playbookRules, rule];
    try {
      await persistRules(next);
      notify(
        existingIdx >= 0 ? "Đã cập nhật rule" : "Đã thêm rule mới",
        "success",
      );
    } catch {
      /* already notified */
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    setDeletingRuleId(ruleId);
    try {
      const next = playbookRules.filter((r) => r.id !== ruleId);
      await persistRules(next);
      notify("Đã xoá rule", "success");
    } catch {
      /* already notified */
    } finally {
      setDeletingRuleId(null);
    }
  };

  const handleToggleRule = async (ruleId: string) => {
    const next = playbookRules.map((r) =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
    );
    try {
      await persistRules(next);
    } catch {
      /* already notified */
    }
  };

  const handleSeedDefaults = async () => {
    const seeds = defaultPlaybookForRole(role);
    if (seeds.length === 0) {
      notify(
        `Chưa có preset mặc định cho vai trò "${AGENT_ROLE_LABELS[role]}"`,
        "default",
      );
      return;
    }
    // Gộp với rule hiện tại (không xoá cái cũ)
    const next = [...playbookRules, ...seeds];
    try {
      await persistRules(next);
      notify(`Đã thêm ${seeds.length} rule mẫu`, "success");
    } catch {
      /* already notified */
    }
  };

  const handleRunPlaybook = async () => {
    if (!agent) return;
    if (playbookRules.filter((r) => r.enabled).length === 0) {
      notify("Chưa có rule nào đang bật để chạy", "warning");
      return;
    }
    setRunningPlaybook(true);
    try {
      const result = await runPlaybookForAgent(agent);
      const msg =
        `Đã tạo ${result.tasksCreated} task · bỏ qua ${result.skipped}` +
        ` · quét ${result.kpisScanned} KPI với ${result.rulesEvaluated} rule`;
      notify(msg, result.tasksCreated > 0 ? "success" : "default");
      await load();
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Lỗi chạy playbook",
        "error",
      );
    } finally {
      setRunningPlaybook(false);
    }
  };

  const copyWebhookExample = async () => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const example = JSON.stringify(
      {
        url: `${origin}/api/ai-agent/task`,
        method: "POST",
        headers: {
          "x-api-key": "<N8N_WEBHOOK_API_KEY>",
          "Content-Type": "application/json",
        },
        body: {
          tenant_id: agent?.tenantId,
          agent_code: agent?.code,
          tasks: [
            {
              task_date: new Date().toISOString().slice(0, 10),
              title: "Ví dụ task",
              priority: "normal",
              assigned_to_role: "cashier",
            },
          ],
        },
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(example);
      notify("Đã copy ví dụ cURL vào clipboard", "success");
    } catch {
      notify("Không copy được", "error");
    }
  };

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

  if (!agent) return null;

  const iconName = AGENT_ROLE_ICONS[agent.role] ?? "smart_toy";

  return (
    <div className="space-y-4">
      <PageHeader
        title={agent.name}
        actions={[
          {
            label: "Về danh sách",
            icon: <Icon name="arrow_back" size={16} />,
            variant: "outline",
            href: "/ai-agents",
          },
          {
            label: runningPlaybook ? "Đang chạy playbook..." : "Chạy playbook",
            icon: (
              <Icon
                name={runningPlaybook ? "progress_activity" : "play_circle"}
                size={16}
                className={runningPlaybook ? "animate-spin" : ""}
              />
            ),
            variant: "outline",
            onClick: handleRunPlaybook,
            disabled: runningPlaybook || playbookRules.length === 0,
          },
          {
            label: triggering ? "Đang chạy..." : "Chạy thử",
            icon: (
              <Icon
                name={triggering ? "progress_activity" : "play_arrow"}
                size={16}
                className={triggering ? "animate-spin" : ""}
              />
            ),
            variant: "default",
            onClick: handleTrigger,
          },
          {
            label: "Xoá",
            icon: <Icon name="delete" size={16} />,
            variant: "ghost",
            onClick: () => setDeleteOpen(true),
            overflow: true,
          },
        ]}
      />

      {/* Header card */}
      <div className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 flex items-center gap-4">
        <div className="size-14 rounded-xl bg-primary-fixed flex items-center justify-center shrink-0">
          <Icon name={iconName} size={28} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">
              {agent.code}
            </span>
            <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-primary-fixed text-primary">
              {AGENT_ROLE_LABELS[agent.role] ?? agent.role}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${
                agent.isActive
                  ? "bg-status-success/10 text-status-success"
                  : "bg-surface-container-high text-muted-foreground"
              }`}
            >
              {agent.isActive ? "Hoạt động" : "Tạm ngưng"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Lần chạy gần nhất: {formatRelative(agent.lastRunAt)} · Tạo{" "}
            {formatRelative(agent.createdAt)}
          </div>
        </div>
      </div>

      {/* Form grid */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Main form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Basic info */}
          <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Icon name="info" size={18} className="text-primary" />
              Thông tin cơ bản
            </h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-name">Tên agent</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: CEO Agent"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-role">Vai trò</Label>
                <select
                  id="agent-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as AgentRole)}
                  className="h-10 w-full rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {AGENT_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-desc">Mô tả</Label>
              <Textarea
                id="agent-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Agent này làm gì, nhận input nào, output nào..."
                rows={3}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={isActive}
                onCheckedChange={(c) => setIsActive(Boolean(c))}
              />
              <span className="text-sm">Agent đang hoạt động</span>
            </label>
          </section>

          {/* n8n integration */}
          <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Icon name="hub" size={18} className="text-primary" />
                Tích hợp n8n
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={copyWebhookExample}
                title="Copy ví dụ cURL cho n8n"
              >
                <Icon name="content_copy" size={14} />
                <span className="ml-1">Copy ví dụ</span>
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">
                Webhook URL
                <span className="text-muted-foreground font-normal ml-1">
                  (URL n8n trả về khi nhận trigger)
                </span>
              </Label>
              <Input
                id="webhook-url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://n8n.onebiz.vn/webhook/agent-ceo"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="workflow-id">
                Workflow ID
                <span className="text-muted-foreground font-normal ml-1">
                  (tuỳ chọn — để tra cứu trên n8n)
                </span>
              </Label>
              <Input
                id="workflow-id"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                placeholder="wf-123abc"
              />
            </div>

            <div className="rounded-lg bg-primary-fixed/40 p-3 text-xs text-primary">
              <div className="font-semibold mb-1 flex items-center gap-1">
                <Icon name="lightbulb" size={14} /> Luồng 2 chiều
              </div>
              <ul className="space-y-1 list-disc list-inside">
                <li>
                  ERP → n8n: &ldquo;Chạy thử&rdquo; sẽ POST vào Webhook URL bên
                  trên.
                </li>
                <li>
                  n8n → ERP: sau khi agent xử lý xong, POST về{" "}
                  <code className="font-mono">/api/ai-agent/task</code> hoặc{" "}
                  <code className="font-mono">/api/ai-agent/kpi</code> với
                  header <code className="font-mono">x-api-key</code>.
                </li>
              </ul>
            </div>
          </section>

          {/* Prompt template */}
          <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Icon name="auto_awesome" size={18} className="text-primary" />
              Prompt template
            </h3>
            <p className="text-xs text-muted-foreground">
              Gửi kèm khi trigger. n8n có thể dùng nội dung này làm system prompt
              cho LLM node.
            </p>
            <Textarea
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              placeholder="Bạn là CEO Agent của chuỗi cà phê OneBiz. Nhiệm vụ của bạn là..."
              rows={8}
              className="font-mono text-xs"
            />
          </section>

          {/* Task queue (Sprint AI-3) */}
          {(() => {
            const workload = summarizeWorkload(agent.id, tasks);
            const filteredTasks = tasks.filter((t) => {
              if (taskFilter === "all") return true;
              if (taskFilter === "overdue")
                return taskUrgency(t) === "overdue";
              return (
                t.status === "pending" ||
                t.status === "in_progress" ||
                t.status === "blocked"
              );
            });
            // Sort: overdue > due_today > due_soon > ok > done, then priority desc
            const urgencyRank: Record<string, number> = {
              overdue: 0,
              due_today: 1,
              due_soon: 2,
              ok: 3,
              done: 4,
            };
            const priorityRank: Record<AgentTaskPriority, number> = {
              urgent: 0,
              high: 1,
              normal: 2,
              low: 3,
            };
            const sorted = [...filteredTasks].sort((a, b) => {
              const ua = urgencyRank[taskUrgency(a)] ?? 99;
              const ub = urgencyRank[taskUrgency(b)] ?? 99;
              if (ua !== ub) return ua - ub;
              return (
                (priorityRank[a.priority] ?? 99) -
                (priorityRank[b.priority] ?? 99)
              );
            });

            return (
              <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Icon name="task_alt" size={18} className="text-primary" />
                      Task queue
                      <span className="text-xs text-muted-foreground font-normal">
                        ({workload.activeCount} đang làm · {workload.done} xong)
                      </span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Các task được gán/tự-sinh cho agent này — sắp theo mức
                      cảnh báo.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {workload.overdue > 0 && (
                      <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-status-error/10 text-status-error flex items-center gap-1">
                        <Icon name="error" size={12} />
                        {workload.overdue} quá hạn
                      </span>
                    )}
                    {workload.dueToday > 0 && (
                      <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-status-warning/10 text-status-warning flex items-center gap-1">
                        <Icon name="schedule" size={12} />
                        {workload.dueToday} hôm nay
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {(
                    [
                      { key: "active", label: `Đang làm (${workload.activeCount + workload.blocked})` },
                      { key: "overdue", label: `Quá hạn (${workload.overdue})` },
                      { key: "all", label: `Tất cả (${tasks.length})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setTaskFilter(f.key)}
                      className={`shrink-0 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${
                        taskFilter === f.key
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container text-foreground/70 hover:bg-surface-container-high"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {sorted.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                    <Icon
                      name="inbox"
                      size={28}
                      className="mx-auto mb-2 opacity-50"
                    />
                    {taskFilter === "overdue"
                      ? "Không có task quá hạn — rất tốt!"
                      : taskFilter === "active"
                        ? "Chưa có task đang làm"
                        : "Chưa có task nào"}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {sorted.map((task) => {
                      const urg = taskUrgency(task);
                      const busy = taskBusyId === task.id;
                      const nextStatus: AgentTaskStatus | null =
                        task.status === "pending"
                          ? "in_progress"
                          : task.status === "in_progress"
                            ? "done"
                            : null;

                      return (
                        <li
                          key={task.id}
                          className="rounded-xl border border-border bg-surface-container-lowest p-3 space-y-2"
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">
                                  {task.title}
                                </span>
                                <span
                                  className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${TASK_URGENCY_TONE[urg]}`}
                                >
                                  <Icon
                                    name={TASK_URGENCY_ICON[urg]}
                                    size={10}
                                    className="inline-block mr-0.5"
                                  />
                                  {TASK_URGENCY_LABELS[urg]}
                                </span>
                                <span
                                  className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${
                                    task.priority === "urgent"
                                      ? "bg-status-error/10 text-status-error"
                                      : task.priority === "high"
                                        ? "bg-status-warning/10 text-status-warning"
                                        : task.priority === "low"
                                          ? "bg-surface-container-high text-muted-foreground"
                                          : "bg-status-info/10 text-status-info"
                                  }`}
                                >
                                  {AGENT_TASK_PRIORITY_LABELS[task.priority]}
                                </span>
                                <span
                                  className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${
                                    AGENT_TASK_STATUS_TONE[task.status] === "neutral"
                                      ? "bg-surface-container-high text-muted-foreground"
                                      : AGENT_TASK_STATUS_TONE[task.status] === "info"
                                        ? "bg-status-info/10 text-status-info"
                                        : AGENT_TASK_STATUS_TONE[task.status] === "success"
                                          ? "bg-status-success/10 text-status-success"
                                          : AGENT_TASK_STATUS_TONE[task.status] === "warning"
                                            ? "bg-status-warning/10 text-status-warning"
                                            : "bg-status-error/10 text-status-error"
                                  }`}
                                >
                                  {AGENT_TASK_STATUS_LABELS[task.status]}
                                </span>
                              </div>
                              {task.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {task.description}
                                </p>
                              )}
                              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                <span>
                                  <Icon
                                    name="event"
                                    size={12}
                                    className="inline-block mr-0.5"
                                  />
                                  {new Date(
                                    task.taskDate,
                                  ).toLocaleDateString("vi-VN")}
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
                                {(() => {
                                  const ruleName = (
                                    task.metadata as Record<string, unknown>
                                  )?.rule_name;
                                  if (typeof ruleName !== "string") return null;
                                  return (
                                    <span className="italic">
                                      <Icon
                                        name="rule"
                                        size={12}
                                        className="inline-block mr-0.5"
                                      />
                                      Playbook: {ruleName}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            {nextStatus && (
                              <Button
                                size="sm"
                                variant="default"
                                disabled={busy}
                                onClick={() =>
                                  handleTaskStatusChange(task.id, nextStatus)
                                }
                              >
                                <Icon
                                  name={
                                    nextStatus === "done"
                                      ? "check"
                                      : "play_arrow"
                                  }
                                  size={14}
                                />
                                <span className="ml-1">
                                  {nextStatus === "done" ? "Hoàn thành" : "Bắt đầu"}
                                </span>
                              </Button>
                            )}
                            {task.status !== "blocked" &&
                              task.status !== "done" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    handleTaskStatusChange(task.id, "blocked")
                                  }
                                >
                                  <Icon name="block" size={14} />
                                  <span className="ml-1">Tắc nghẽn</span>
                                </Button>
                              )}
                            <select
                              value={task.priority}
                              disabled={busy}
                              onChange={(e) =>
                                handleTaskPriorityChange(
                                  task.id,
                                  e.target.value as AgentTaskPriority,
                                )
                              }
                              title="Đổi priority"
                              className="h-7 rounded-lg border border-input bg-surface-container-lowest px-2 text-xs outline-none focus-visible:border-primary"
                            >
                              {(
                                [
                                  "low",
                                  "normal",
                                  "high",
                                  "urgent",
                                ] as AgentTaskPriority[]
                              ).map((p) => (
                                <option key={p} value={p}>
                                  {AGENT_TASK_PRIORITY_LABELS[p]}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => handleTaskReassignRole(task.id)}
                              title="Gán cho role khác"
                            >
                              <Icon name="swap_horiz" size={14} />
                              <span className="ml-1">Reassign</span>
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })()}

          {/* Playbook (Sprint AI-2) */}
          <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Icon
                    name="rule"
                    size={18}
                    className="text-primary"
                  />
                  Playbook rules
                  <span className="text-xs text-muted-foreground font-normal">
                    ({playbookRules.length})
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Rule = điều kiện trigger + task tự tạo. Dùng &ldquo;Chạy
                  playbook&rdquo; để quét tất cả KPI và tạo task phù hợp.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSeedDefaults}
                  disabled={savingRules}
                  title={`Thêm preset mặc định cho vai trò ${AGENT_ROLE_LABELS[role]}`}
                >
                  <Icon name="auto_awesome" size={14} className="mr-1" />
                  Thêm preset mẫu
                </Button>
                <Button size="sm" onClick={handleOpenAddRule} disabled={savingRules}>
                  <Icon name="add" size={14} className="mr-1" />
                  Thêm rule
                </Button>
              </div>
            </div>

            {playbookRules.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                <Icon
                  name="playlist_add"
                  size={28}
                  className="mx-auto mb-2 opacity-50"
                />
                <div>Chưa có rule nào</div>
                <div className="text-xs mt-1">
                  Thêm rule để agent tự sinh task khi KPI chạm điều kiện
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {playbookRules.map((rule) => (
                  <li
                    key={rule.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      rule.enabled
                        ? "bg-surface-container-lowest border-border"
                        : "bg-surface-container/40 border-border/60 opacity-70"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        disabled={savingRules}
                        title={rule.enabled ? "Tắt rule" : "Bật rule"}
                        className={`mt-0.5 size-8 rounded-lg flex items-center justify-center shrink-0 press-scale-sm transition-colors ${
                          rule.enabled
                            ? "bg-status-success/10 text-status-success hover:bg-status-success/20"
                            : "bg-surface-container-high text-muted-foreground hover:bg-surface-container-highest"
                        }`}
                      >
                        <Icon
                          name={rule.enabled ? "toggle_on" : "toggle_off"}
                          size={20}
                        />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {rule.name || "(chưa đặt tên)"}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-primary-fixed text-primary">
                            {PLAYBOOK_TRIGGER_LABELS[rule.trigger]}
                          </span>
                          <span
                            className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${
                              rule.action.priority === "urgent"
                                ? "bg-status-error/10 text-status-error"
                                : rule.action.priority === "high"
                                  ? "bg-status-warning/10 text-status-warning"
                                  : rule.action.priority === "low"
                                    ? "bg-surface-container-high text-muted-foreground"
                                    : "bg-status-info/10 text-status-info"
                            }`}
                          >
                            {AGENT_TASK_PRIORITY_LABELS[rule.action.priority]}
                          </span>
                        </div>

                        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          <div className="flex items-center gap-1 flex-wrap">
                            <Icon name="filter_alt" size={12} />
                            <span>
                              {rule.kpiTypes.length === 0
                                ? "Tất cả loại KPI"
                                : rule.kpiTypes
                                    .map((t) => KPI_TYPE_LABELS[t])
                                    .join(", ")}
                            </span>
                            <span className="mx-1 opacity-40">·</span>
                            <span>
                              {rule.periods.length === 0
                                ? "Tất cả kỳ"
                                : rule.periods
                                    .map((p) => KPI_PERIOD_LABELS[p])
                                    .join(", ")}
                            </span>
                          </div>
                          <div className="flex items-start gap-1">
                            <Icon
                              name="add_task"
                              size={12}
                              className="mt-0.5 shrink-0"
                            />
                            <span className="line-clamp-2 font-mono text-[11px]">
                              {rule.action.titleTemplate ||
                                "(chưa có tiêu đề task)"}
                            </span>
                          </div>
                          {rule.action.assignedToRole && (
                            <div className="flex items-center gap-1">
                              <Icon name="person" size={12} />
                              <span>
                                Giao cho role: {rule.action.assignedToRole}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleOpenEditRule(rule)}
                          title="Sửa rule"
                          disabled={savingRules}
                        >
                          <Icon name="edit" size={14} />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleDeleteRule(rule.id)}
                          title="Xoá rule"
                          disabled={savingRules || deletingRuleId === rule.id}
                        >
                          <Icon
                            name={
                              deletingRuleId === rule.id
                                ? "progress_activity"
                                : "delete"
                            }
                            size={14}
                            className={
                              deletingRuleId === rule.id ? "animate-spin" : ""
                            }
                          />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Config JSON */}
          <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Icon name="tune" size={18} className="text-primary" />
              Config (JSON)
            </h3>
            <p className="text-xs text-muted-foreground">
              Cấu hình riêng cho agent — VD model, temperature, threshold...
              Playbook được quản lý ở mục trên; field <code>playbook</code> ở
              đây chỉ đọc.
            </p>
            <Textarea
              value={configJson}
              onChange={(e) => handleConfigChange(e.target.value)}
              placeholder='{"model": "gpt-4o-mini", "temperature": 0.3}'
              rows={6}
              className="font-mono text-xs"
              aria-invalid={configError ? true : undefined}
            />
            {configError && (
              <div className="text-xs text-status-error">
                <Icon name="error" size={12} className="inline mr-1" />
                {configError}
              </div>
            )}
          </section>

          {/* Save bar */}
          <div className="sticky bottom-4 flex justify-end gap-2 bg-surface-container-lowest/80 backdrop-blur-md rounded-xl border border-border ambient-shadow p-3">
            <Link href="/ai-agents">
              <Button variant="outline" disabled={saving}>
                Huỷ
              </Button>
            </Link>
            <Button
              onClick={handleSave}
              disabled={saving || Boolean(configError)}
            >
              <Icon
                name={saving ? "progress_activity" : "save"}
                size={16}
                className={saving ? "animate-spin" : ""}
              />
              <span className="ml-1">
                {saving ? "Đang lưu..." : "Lưu cấu hình"}
              </span>
            </Button>
          </div>
        </div>

        {/* Sidebar — executions */}
        <aside className="space-y-3">
          <section className="bg-surface-container-lowest rounded-xl ambient-shadow border border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Icon name="history" size={18} className="text-primary" />
                Log gần đây
              </h3>
              <span className="text-xs text-muted-foreground">
                {executions.length}
              </span>
            </div>

            {executions.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                <Icon
                  name="hourglass_empty"
                  size={28}
                  className="mx-auto mb-2 opacity-50"
                />
                Chưa có lần chạy nào
              </div>
            ) : (
              <div className="space-y-2 max-h-[640px] overflow-auto pr-1">
                {executions.map((ex) => (
                  <ExecutionCard key={ex.id} execution={ex} />
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá agent"
        description={`Bạn có chắc muốn xoá "${agent.name}"? Các KPI/task đã tạo sẽ được giữ lại nhưng mất liên kết agent.`}
        confirmLabel="Xoá"
        cancelLabel="Huỷ"
        variant="destructive"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <EditPlaybookRuleDialog
        open={playbookDialogOpen}
        onOpenChange={setPlaybookDialogOpen}
        initialRule={editingRule}
        onSave={handleSaveRule}
      />
    </div>
  );
}
