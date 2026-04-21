/**
 * AI Agents Service — CRUD + triggers cho hệ thống AI Agent n8n integration.
 *
 * Phase Next: Agents CEO/HR/Marketing/Sales/Operations/Finance
 *   - CRUD agent config + prompt template
 *   - KPI breakdown tree (parent → children)
 *   - Agent task daily (assign to user/role)
 *   - Agent execution log (n8n trigger history)
 */

import { getClient, getCurrentContext, handleError } from "./base";
import type { Json } from "@/lib/supabase/types";
import type {
  Agent,
  AgentExecution,
  AgentTask,
  AgentTaskStatus,
  CreateAgentInput,
  CreateAgentTaskInput,
  CreateKpiBreakdownInput,
  KpiBreakdown,
  KpiBreakdownTreeNode,
  UpdateAgentInput,
} from "@/lib/types/ai-agents";

// Helper: cast bất kỳ plain object nào sang Json type (Supabase yêu cầu Json cho các cột JSONB)
function toJson(v: unknown): Json {
  return v as Json;
}

// ────────────────────────────────────────────
// Row → Domain mappers
// ────────────────────────────────────────────
function mapAgent(row: Record<string, any>): Agent {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    role: row.role,
    description: row.description ?? null,
    promptTemplate: row.prompt_template ?? null,
    n8nWebhookUrl: row.n8n_webhook_url ?? null,
    n8nWorkflowId: row.n8n_workflow_id ?? null,
    config: row.config ?? {},
    isActive: row.is_active ?? true,
    lastRunAt: row.last_run_at ?? null,
    createdBy: row.created_by ?? null,
    createdByName: profile?.full_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKpiBreakdown(row: Record<string, any>): KpiBreakdown {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id ?? null,
    kpiName: row.kpi_name,
    kpiType: row.kpi_type,
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    targetValue: Number(row.target_value ?? 0),
    actualValue: Number(row.actual_value ?? 0),
    unit: row.unit ?? null,
    ownerRole: row.owner_role ?? null,
    ownerUserId: row.owner_user_id ?? null,
    branchId: row.branch_id ?? null,
    sourceAgentId: row.source_agent_id ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentTask(row: Record<string, any>): AgentTask {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id ?? null,
    kpiBreakdownId: row.kpi_breakdown_id ?? null,
    taskDate: row.task_date,
    title: row.title,
    description: row.description ?? null,
    priority: row.priority,
    status: row.status,
    assignedToUserId: row.assigned_to_user_id ?? null,
    assignedToRole: row.assigned_to_role ?? null,
    branchId: row.branch_id ?? null,
    targetMetric: row.target_metric ?? null,
    actualMetric: row.actual_metric ?? null,
    dueTime: row.due_time ?? null,
    completedAt: row.completed_at ?? null,
    completedByUserId: row.completed_by_user_id ?? null,
    notes: row.notes ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentExecution(row: Record<string, any>): AgentExecution {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    triggerSource: row.trigger_source,
    triggeredAt: row.triggered_at,
    durationMs: row.duration_ms ?? null,
    status: row.status,
    inputData: row.input_data ?? {},
    outputData: row.output_data ?? {},
    errorMessage: row.error_message ?? null,
    tokenUsage: row.token_usage ?? null,
    completedAt: row.completed_at ?? null,
  };
}

// ────────────────────────────────────────────
// Agents CRUD
// ────────────────────────────────────────────
export async function getAgents(): Promise<Agent[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*, profiles!agents_created_by_fkey(full_name)")
    .order("role", { ascending: true })
    .order("name", { ascending: true });
  if (error) handleError(error, "getAgents");
  return (data ?? []).map(mapAgent);
}

export async function getAgentById(id: string): Promise<Agent | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*, profiles!agents_created_by_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) handleError(error, "getAgentById");
  return data ? mapAgent(data) : null;
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { data, error } = await supabase
    .from("agents")
    .insert({
      tenant_id: ctx.tenantId,
      code: input.code,
      name: input.name,
      role: input.role,
      description: input.description ?? null,
      prompt_template: input.promptTemplate ?? null,
      n8n_webhook_url: input.n8nWebhookUrl ?? null,
      n8n_workflow_id: input.n8nWorkflowId ?? null,
      config: toJson(input.config ?? {}),
      is_active: input.isActive ?? true,
      created_by: ctx.userId,
    })
    .select()
    .single();
  if (error) handleError(error, "createAgent");
  return mapAgent(data);
}

export async function updateAgent(input: UpdateAgentInput): Promise<Agent> {
  const supabase = getClient();
  const patch: Record<string, unknown> = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.name !== undefined) patch.name = input.name;
  if (input.role !== undefined) patch.role = input.role;
  if (input.description !== undefined) patch.description = input.description;
  if (input.promptTemplate !== undefined)
    patch.prompt_template = input.promptTemplate;
  if (input.n8nWebhookUrl !== undefined)
    patch.n8n_webhook_url = input.n8nWebhookUrl;
  if (input.n8nWorkflowId !== undefined)
    patch.n8n_workflow_id = input.n8nWorkflowId;
  if (input.config !== undefined) patch.config = toJson(input.config);
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const { data, error } = await supabase
    .from("agents")
    .update(patch as never)
    .eq("id", input.id)
    .select()
    .single();
  if (error) handleError(error, "updateAgent");
  return mapAgent(data);
}

export async function deleteAgent(id: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from("agents").delete().eq("id", id);
  if (error) handleError(error, "deleteAgent");
}

/**
 * Seed 6 agent mặc định cho tenant (CEO/HR/Marketing/Sales/Operations/Finance).
 * Idempotent — gọi nhiều lần không duplicate.
 */
export async function seedDefaultAgents(): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { error } = await supabase.rpc("seed_default_agents", {
    p_tenant_id: ctx.tenantId,
  });
  if (error) handleError(error, "seedDefaultAgents");
}

// ────────────────────────────────────────────
// KPI Breakdowns
// ────────────────────────────────────────────
export async function getKpiBreakdowns(params?: {
  period?: string;
  branchId?: string;
  ownerUserId?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<KpiBreakdown[]> {
  const supabase = getClient();
  let query = supabase
    .from("kpi_breakdowns")
    .select("*")
    .order("period_start", { ascending: false })
    .order("kpi_name", { ascending: true });

  if (params?.period) query = query.eq("period", params.period as never);
  if (params?.branchId) query = query.eq("branch_id", params.branchId);
  if (params?.ownerUserId)
    query = query.eq("owner_user_id", params.ownerUserId);
  if (params?.periodStart) query = query.gte("period_start", params.periodStart);
  if (params?.periodEnd) query = query.lte("period_end", params.periodEnd);

  const { data, error } = await query;
  if (error) handleError(error, "getKpiBreakdowns");
  return (data ?? []).map(mapKpiBreakdown);
}

export async function getKpiBreakdownTree(
  rootId?: string,
): Promise<KpiBreakdownTreeNode[]> {
  const all = await getKpiBreakdowns();
  const byParent = new Map<string | null, KpiBreakdown[]>();
  for (const kpi of all) {
    const key = kpi.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(kpi);
  }

  const build = (parentId: string | null): KpiBreakdownTreeNode[] =>
    (byParent.get(parentId) ?? []).map((node) => ({
      ...node,
      children: build(node.id),
    }));

  return rootId ? build(rootId) : build(null);
}

export async function createKpiBreakdown(
  input: CreateKpiBreakdownInput,
): Promise<KpiBreakdown> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { data, error } = await supabase
    .from("kpi_breakdowns")
    .insert({
      tenant_id: ctx.tenantId,
      parent_id: input.parentId ?? null,
      kpi_name: input.kpiName,
      kpi_type: input.kpiType,
      period: input.period,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      target_value: input.targetValue,
      actual_value: input.actualValue ?? 0,
      unit: input.unit ?? null,
      owner_role: input.ownerRole ?? null,
      owner_user_id: input.ownerUserId ?? null,
      branch_id: input.branchId ?? null,
      source_agent_id: input.sourceAgentId ?? null,
      metadata: toJson(input.metadata ?? {}),
    })
    .select()
    .single();
  if (error) handleError(error, "createKpiBreakdown");
  return mapKpiBreakdown(data);
}

export async function updateKpiActual(
  id: string,
  actualValue: number,
): Promise<KpiBreakdown> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("kpi_breakdowns")
    .update({ actual_value: actualValue })
    .eq("id", id)
    .select()
    .single();
  if (error) handleError(error, "updateKpiActual");
  return mapKpiBreakdown(data);
}

export async function deleteKpiBreakdown(id: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("kpi_breakdowns")
    .delete()
    .eq("id", id);
  if (error) handleError(error, "deleteKpiBreakdown");
}

// ────────────────────────────────────────────
// Agent Tasks
// ────────────────────────────────────────────
export async function getAgentTasks(params?: {
  taskDate?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: AgentTaskStatus;
  assignedToUserId?: string;
  agentId?: string;
  branchId?: string;
}): Promise<AgentTask[]> {
  const supabase = getClient();
  let query = supabase
    .from("agent_tasks")
    .select("*")
    .order("task_date", { ascending: false })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (params?.taskDate) query = query.eq("task_date", params.taskDate);
  if (params?.dateFrom) query = query.gte("task_date", params.dateFrom);
  if (params?.dateTo) query = query.lte("task_date", params.dateTo);
  if (params?.status) query = query.eq("status", params.status);
  if (params?.assignedToUserId)
    query = query.eq("assigned_to_user_id", params.assignedToUserId);
  if (params?.agentId) query = query.eq("agent_id", params.agentId);
  if (params?.branchId) query = query.eq("branch_id", params.branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getAgentTasks");
  return (data ?? []).map(mapAgentTask);
}

export async function createAgentTask(
  input: CreateAgentTaskInput,
): Promise<AgentTask> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { data, error } = await supabase
    .from("agent_tasks")
    .insert({
      tenant_id: ctx.tenantId,
      agent_id: input.agentId ?? null,
      kpi_breakdown_id: input.kpiBreakdownId ?? null,
      task_date: input.taskDate,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      status: input.status ?? "pending",
      assigned_to_user_id: input.assignedToUserId ?? null,
      assigned_to_role: input.assignedToRole ?? null,
      branch_id: input.branchId ?? null,
      target_metric: input.targetMetric ?? null,
      due_time: input.dueTime ?? null,
      metadata: toJson(input.metadata ?? {}),
    })
    .select()
    .single();
  if (error) handleError(error, "createAgentTask");
  return mapAgentTask(data);
}

export async function updateAgentTaskStatus(
  id: string,
  status: AgentTaskStatus,
  extras?: {
    actualMetric?: string;
    notes?: string;
    completedByUserId?: string;
  },
): Promise<AgentTask> {
  const supabase = getClient();
  const patch: Record<string, unknown> = { status };
  if (extras?.actualMetric !== undefined)
    patch.actual_metric = extras.actualMetric;
  if (extras?.notes !== undefined) patch.notes = extras.notes;
  if (status === "done") {
    patch.completed_at = new Date().toISOString();
    if (extras?.completedByUserId)
      patch.completed_by_user_id = extras.completedByUserId;
  }

  const { data, error } = await supabase
    .from("agent_tasks")
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) handleError(error, "updateAgentTaskStatus");
  return mapAgentTask(data);
}

export async function deleteAgentTask(id: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from("agent_tasks").delete().eq("id", id);
  if (error) handleError(error, "deleteAgentTask");
}

/**
 * Cập nhật các field tổng quát của task (priority, description, assignedTo...).
 * Dùng cho intervene actions — escalate, reassign, bump priority.
 */
export async function updateAgentTask(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    priority: AgentTask["priority"];
    assignedToUserId: string | null;
    assignedToRole: string | null;
    dueTime: string | null;
    notes: string | null;
    targetMetric: string | null;
    branchId: string | null;
    agentId: string | null;
  }>,
): Promise<AgentTask> {
  const supabase = getClient();
  const dbPatch: Record<string, unknown> = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.priority !== undefined) dbPatch.priority = patch.priority;
  if (patch.assignedToUserId !== undefined)
    dbPatch.assigned_to_user_id = patch.assignedToUserId;
  if (patch.assignedToRole !== undefined)
    dbPatch.assigned_to_role = patch.assignedToRole;
  if (patch.dueTime !== undefined) dbPatch.due_time = patch.dueTime;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.targetMetric !== undefined)
    dbPatch.target_metric = patch.targetMetric;
  if (patch.branchId !== undefined) dbPatch.branch_id = patch.branchId;
  if (patch.agentId !== undefined) dbPatch.agent_id = patch.agentId;

  const { data, error } = await supabase
    .from("agent_tasks")
    .update(dbPatch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) handleError(error, "updateAgentTask");
  return mapAgentTask(data);
}

// ────────────────────────────────────────────
// Agent Executions (log)
// ────────────────────────────────────────────
export async function getAgentExecutions(params?: {
  agentId?: string;
  status?: string;
  limit?: number;
}): Promise<AgentExecution[]> {
  const supabase = getClient();
  let query = supabase
    .from("agent_executions")
    .select("*")
    .order("triggered_at", { ascending: false });

  if (params?.agentId) query = query.eq("agent_id", params.agentId);
  if (params?.status) query = query.eq("status", params.status as never);
  if (params?.limit) query = query.limit(params.limit);
  else query = query.limit(50);

  const { data, error } = await query;
  if (error) handleError(error, "getAgentExecutions");
  return (data ?? []).map(mapAgentExecution);
}

/**
 * Record execution log từ n8n webhook call.
 * Thường được API route gọi, không phải UI.
 */
export async function recordAgentExecution(input: {
  agentId: string;
  triggerSource?: "n8n" | "manual" | "cron";
  status: "running" | "success" | "failed" | "timeout";
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
  tokenUsage?: Record<string, number>;
  durationMs?: number;
  completedAt?: string;
}): Promise<AgentExecution> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { data, error } = await supabase
    .from("agent_executions")
    .insert({
      tenant_id: ctx.tenantId,
      agent_id: input.agentId,
      trigger_source: input.triggerSource ?? "n8n",
      status: input.status,
      input_data: toJson(input.inputData ?? {}),
      output_data: toJson(input.outputData ?? {}),
      error_message: input.errorMessage ?? null,
      token_usage: input.tokenUsage ? toJson(input.tokenUsage) : null,
      duration_ms: input.durationMs ?? null,
      completed_at: input.completedAt ?? null,
    })
    .select()
    .single();
  if (error) handleError(error, "recordAgentExecution");

  // Cập nhật last_run_at trên agent
  await supabase
    .from("agents")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", input.agentId);

  return mapAgentExecution(data);
}

/**
 * Trigger n8n webhook cho agent, đồng thời record execution log.
 * Return execution ID để UI theo dõi.
 */
export async function triggerAgent(
  agentId: string,
  payload?: Record<string, unknown>,
): Promise<{ executionId: string; response?: unknown }> {
  const agent = await getAgentById(agentId);
  if (!agent) throw new Error("Không tìm thấy agent");
  if (!agent.n8nWebhookUrl)
    throw new Error("Agent chưa cấu hình n8n webhook URL");
  if (!agent.isActive) throw new Error("Agent đang tạm ngưng");

  const start = Date.now();
  const execution = await recordAgentExecution({
    agentId,
    triggerSource: "manual",
    status: "running",
    inputData: payload ?? {},
  });

  try {
    const res = await fetch(agent.n8nWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_code: agent.code,
        agent_role: agent.role,
        tenant_id: agent.tenantId,
        payload: payload ?? {},
      }),
    });
    const responseData = await res.json().catch(() => ({}));
    const duration = Date.now() - start;

    const supabase = getClient();
    await supabase
      .from("agent_executions")
      .update({
        status: res.ok ? "success" : "failed",
        output_data: toJson(responseData),
        duration_ms: duration,
        completed_at: new Date().toISOString(),
        error_message: res.ok ? null : `HTTP ${res.status}`,
      })
      .eq("id", execution.id);

    return { executionId: execution.id, response: responseData };
  } catch (err) {
    const duration = Date.now() - start;
    const supabase = getClient();
    await supabase
      .from("agent_executions")
      .update({
        status: "failed",
        duration_ms: duration,
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq("id", execution.id);
    throw err;
  }
}
