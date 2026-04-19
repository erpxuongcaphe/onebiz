/**
 * AI Agents — Types cho hệ thống AI Agent tích hợp n8n.io
 *
 * Phase Next: CEO/HR/Marketing/Sales/Operations/Finance agents
 *   → Nhận KPI, break down → task hàng ngày cho nhân sự
 */

export type AgentRole =
  | "ceo"
  | "hr"
  | "marketing"
  | "sales"
  | "operations"
  | "finance"
  | "custom";

export type KpiType =
  | "revenue"
  | "orders"
  | "customers"
  | "profit"
  | "inventory"
  | "tasks"
  | "custom";

export type KpiPeriod =
  | "yearly"
  | "quarterly"
  | "monthly"
  | "weekly"
  | "daily";

export type AgentTaskPriority = "low" | "normal" | "high" | "urgent";

export type AgentTaskStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "skipped"
  | "blocked";

export type AgentExecutionStatus = "running" | "success" | "failed" | "timeout";

export type AgentTriggerSource = "n8n" | "manual" | "cron";

// ────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────
export interface Agent {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  role: AgentRole;
  description?: string | null;
  promptTemplate?: string | null;
  n8nWebhookUrl?: string | null;
  n8nWorkflowId?: string | null;
  config: Record<string, unknown>;
  isActive: boolean;
  lastRunAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  code: string;
  name: string;
  role: AgentRole;
  description?: string;
  promptTemplate?: string;
  n8nWebhookUrl?: string;
  n8nWorkflowId?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  id: string;
}

// ────────────────────────────────────────────
// KPI Breakdown
// ────────────────────────────────────────────
export interface KpiBreakdown {
  id: string;
  tenantId: string;
  parentId?: string | null;
  kpiName: string;
  kpiType: KpiType;
  period: KpiPeriod;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  targetValue: number;
  actualValue: number;
  unit?: string | null;
  ownerRole?: string | null;
  ownerUserId?: string | null;
  branchId?: string | null;
  sourceAgentId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKpiBreakdownInput {
  parentId?: string;
  kpiName: string;
  kpiType: KpiType;
  period: KpiPeriod;
  periodStart: string;
  periodEnd: string;
  targetValue: number;
  actualValue?: number;
  unit?: string;
  ownerRole?: string;
  ownerUserId?: string;
  branchId?: string;
  sourceAgentId?: string;
  metadata?: Record<string, unknown>;
}

export interface KpiBreakdownTreeNode extends KpiBreakdown {
  children: KpiBreakdownTreeNode[];
}

// ────────────────────────────────────────────
// Agent Task
// ────────────────────────────────────────────
export interface AgentTask {
  id: string;
  tenantId: string;
  agentId?: string | null;
  kpiBreakdownId?: string | null;
  taskDate: string; // ISO date
  title: string;
  description?: string | null;
  priority: AgentTaskPriority;
  status: AgentTaskStatus;
  assignedToUserId?: string | null;
  assignedToRole?: string | null;
  branchId?: string | null;
  targetMetric?: string | null;
  actualMetric?: string | null;
  dueTime?: string | null;
  completedAt?: string | null;
  completedByUserId?: string | null;
  notes?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentTaskInput {
  agentId?: string;
  kpiBreakdownId?: string;
  taskDate: string;
  title: string;
  description?: string;
  priority?: AgentTaskPriority;
  status?: AgentTaskStatus;
  assignedToUserId?: string;
  assignedToRole?: string;
  branchId?: string;
  targetMetric?: string;
  dueTime?: string;
  metadata?: Record<string, unknown>;
}

// ────────────────────────────────────────────
// Agent Execution Log
// ────────────────────────────────────────────
export interface AgentExecution {
  id: string;
  tenantId: string;
  agentId: string;
  triggerSource: AgentTriggerSource;
  triggeredAt: string;
  durationMs?: number | null;
  status: AgentExecutionStatus;
  inputData: Record<string, unknown>;
  outputData: Record<string, unknown>;
  errorMessage?: string | null;
  tokenUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  completedAt?: string | null;
}

// ────────────────────────────────────────────
// Role labels
// ────────────────────────────────────────────
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO Agent",
  hr: "HR Agent",
  marketing: "Marketing Agent",
  sales: "Sales Agent",
  operations: "Operations Agent",
  finance: "Finance Agent",
  custom: "Agent tuỳ chỉnh",
};

export const AGENT_ROLE_ICONS: Record<AgentRole, string> = {
  ceo: "workspace_premium",
  hr: "group",
  marketing: "campaign",
  sales: "trending_up",
  operations: "settings",
  finance: "account_balance",
  custom: "smart_toy",
};

export const KPI_PERIOD_LABELS: Record<KpiPeriod, string> = {
  yearly: "Năm",
  quarterly: "Quý",
  monthly: "Tháng",
  weekly: "Tuần",
  daily: "Ngày",
};

export const KPI_TYPE_LABELS: Record<KpiType, string> = {
  revenue: "Doanh thu",
  orders: "Đơn hàng",
  customers: "Khách hàng",
  profit: "Lợi nhuận",
  inventory: "Tồn kho",
  tasks: "Công việc",
  custom: "Tuỳ chỉnh",
};

export const AGENT_TASK_STATUS_LABELS: Record<AgentTaskStatus, string> = {
  pending: "Chờ",
  in_progress: "Đang làm",
  done: "Hoàn thành",
  skipped: "Bỏ qua",
  blocked: "Tắc nghẽn",
};

export const AGENT_TASK_STATUS_TONE: Record<
  AgentTaskStatus,
  "neutral" | "info" | "success" | "warning" | "error"
> = {
  pending: "neutral",
  in_progress: "info",
  done: "success",
  skipped: "warning",
  blocked: "error",
};

export const AGENT_TASK_PRIORITY_LABELS: Record<AgentTaskPriority, string> = {
  low: "Thấp",
  normal: "Bình thường",
  high: "Cao",
  urgent: "Khẩn cấp",
};

export const AGENT_EXECUTION_STATUS_LABELS: Record<
  AgentExecutionStatus,
  string
> = {
  running: "Đang chạy",
  success: "Thành công",
  failed: "Thất bại",
  timeout: "Hết giờ",
};

// ────────────────────────────────────────────
// Playbook (Sprint AI-2)
// ────────────────────────────────────────────

/** Điều kiện kích hoạt rule */
export type PlaybookTriggerType =
  /** Tiến độ thấp: actual/target < threshold AND kỳ còn ít thời gian */
  | "progress_low"
  /** Tiến độ đang vượt target — tạo task chia sẻ/thưởng */
  | "progress_high"
  /** Lệch target sau X ngày đầu kỳ (kỳ mới start nhưng actual = 0) */
  | "no_activity"
  /** Cập nhật định kỳ: mỗi N ngày tạo 1 task review */
  | "periodic_review";

export const PLAYBOOK_TRIGGER_LABELS: Record<PlaybookTriggerType, string> = {
  progress_low: "Tiến độ thấp",
  progress_high: "Tiến độ vượt",
  no_activity: "Chưa có hoạt động",
  periodic_review: "Review định kỳ",
};

/** Một playbook rule gắn vào agent.config.playbook[] */
export interface PlaybookRule {
  /** ID local (uuid do client gen) — persist trong JSONB */
  id: string;
  /** Tên rule cho user dễ nhận biết */
  name: string;
  /** Áp dụng cho kpiType nào — empty = tất cả */
  kpiTypes: KpiType[];
  /** Chỉ quét KPI ở kỳ này — empty = tất cả */
  periods: KpiPeriod[];
  trigger: PlaybookTriggerType;
  /** Param của trigger */
  triggerParams: {
    /** progress_low/high: ngưỡng % (0-100) */
    progressThresholdPct?: number;
    /** progress_low: chỉ cảnh báo khi kỳ đã chạy > X% thời gian */
    minElapsedPct?: number;
    /** no_activity: số ngày đầu kỳ */
    firstNDays?: number;
    /** periodic_review: mỗi bao nhiêu ngày */
    everyNDays?: number;
  };
  /** Task sẽ được tạo */
  action: {
    titleTemplate: string;
    descriptionTemplate?: string;
    priority: AgentTaskPriority;
    assignedToRole?: string;
    /** Số ngày cộng vào hôm nay để set due date của task */
    dueOffsetDays?: number;
  };
  enabled: boolean;
}

export interface AgentPlaybookConfig {
  playbook?: PlaybookRule[];
}

/** Kết quả eval 1 rule đối với 1 KPI — đánh dấu có nên tạo task không */
export interface PlaybookEvalResult {
  ruleId: string;
  ruleName: string;
  kpiId: string;
  kpiName: string;
  matched: boolean;
  /** Lý do match hoặc không match — để hiển thị log */
  reason: string;
  /** Nếu matched: payload task sẽ tạo (chưa insert) */
  taskPayload?: {
    title: string;
    description?: string;
    priority: AgentTaskPriority;
    assignedToRole?: string;
    dueDate: string;
    kpiBreakdownId: string;
  };
}

export interface RunPlaybookResult {
  agentId: string;
  agentName: string;
  rulesEvaluated: number;
  kpisScanned: number;
  tasksCreated: number;
  skipped: number;
  evals: PlaybookEvalResult[];
}
