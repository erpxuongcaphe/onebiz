import { z } from "zod";

export const operationActions = [
  "member",
  "standard",
  "common_standard",
  "approve_standard",
  "propose_standard",
  "request_standard_changes",
  "generate",
  "ensure_schedule",
  "event",
  "result",
  "verify",
  "todo",
  "transfer",
  "todo_update",
  "comment",
  "target",
  "revenue",
  "revenue_batch",
  "onebiz_revenue",
  "approve_revenue",
  "policy",
  "approve_policy",
  "close_period",
] as const;
export const commandSchema = z
  .object({
    action: z.enum(operationActions),
    requestId: z.uuid(),
    payload: z
      .record(z.string(), z.unknown())
      .refine(
        (value) => z.uuid().safeParse(value.branchId).success,
        "Chọn chi nhánh hợp lệ.",
      ),
  })
  .strict();

export interface Person {
  id: string;
  name: string;
}
export interface Branch extends Person {
  code: string;
  capabilities: string[];
}
export interface Criterion {
  id: string;
  title: string;
  kind: "boolean" | "number" | "percent" | "duration";
  operator: "eq" | "lte" | "gte" | "lt";
  threshold: number;
  samples: number;
  critical: boolean;
  evidenceRequired: boolean;
  measurementScope?: string;
  measurementTimes?: string[];
  ratioBasis?: string;
}
export interface Observation {
  criterionId: string;
  slot: string;
  value: number;
  evidence?: string;
  numerator?: number;
  denominator?: number;
  measuredAt?: string;
  measurementId?: string;
}
export interface Run {
  id: string;
  title: string;
  assignee_id: string;
  original_due_at: string;
  state: string;
  quality: "met" | "unmet" | "unknown";
  met_at: string | null;
  verified_at: string | null;
  critical_failure: boolean;
  had_failure?: boolean;
  criteria: Criterion[];
  observations: Observation[];
  version: number;
}
export interface Standard {
  id: string;
  branch_id: string;
  family_id: string;
  revision: number;
  scope: "common" | "branch";
  description: string;
  day_number: number;
  due_time: string;
  effective_from: string;
  title: string;
  status: string;
  frequency: string;
  assignee_id: string;
  criteria: Criterion[];
  created_by?: string;
  review_note?: string | null;
}
export interface Todo {
  id: string;
  branch_id: string;
  run_id: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  state: string;
  assignee_id: string;
  collaborators: string[];
  created_at: string;
  due_at: string;
  completed_at: string | null;
  version: number;
}
export interface Revenue {
  id: string;
  source: string;
  source_name: string;
  amount_cents: number;
  state: string;
  evidence: string;
  definition: { label: string };
}
export interface Workspace {
  todosOverdue?: number;
  userId: string;
  isCeo: boolean;
  period: string;
  branches: Branch[];
  people: Person[];
  members: { user_id: string; member_role: string; active: boolean; capabilities?: string[] }[];
  standards: Standard[];
  runs: Run[];
  todos: Todo[];
  revenues: Revenue[];
  targets: { amount_cents: number; definition: { label: string } }[];
  policies: {
    id: string;
    title: string;
    state: string;
    effective_from: string;
    config: import("./policy").RewardPolicy;
  }[];
  periods: { id: string; closed_at: string; snapshot: unknown }[];
  audit: {
    id: string;
    entity_id?: string | null;
    after_data?: { note?: string } | null;
    action: string;
    actor_id: string;
    created_at: string;
    reason: string | null;
  }[];
}

export const categories = {
  operations: "Vận hành",
  hr: "Nhân sự",
  maintenance: "Bảo trì",
  complaint: "Khiếu nại khách hàng",
  food_safety: "VSATTP",
  product: "Sản phẩm",
  goods: "Hàng hóa",
  cleaning: "Vệ sinh",
  space: "Không gian",
  equipment: "Thiết bị",
  other: "Khác",
};
export const priorities = {
  important_urgent: "Quan trọng và khẩn cấp",
  important: "Quan trọng, không khẩn cấp",
  urgent: "Không quan trọng, khẩn cấp",
  normal: "Không quan trọng, không khẩn cấp",
};
export const states: Record<string, string> = {
  pending: "Chưa thực hiện",
  in_progress: "Đang xử lý",
  waiting: "Chờ phối hợp",
  done: "Hoàn thành",
  canceled: "Đã hủy",
  transferred: "Chuyển To-do",
  draft: "Bản nháp",
  pending_approval: "Chờ CEO duyệt",
  changes_requested: "Cần sửa đề xuất",
  retired: "Ngừng áp dụng",
  approved: "Đã duyệt",
  superseded: "Đã thay thế",
  met: "Đạt",
  unmet: "Chưa đạt",
  unknown: "Chưa đủ kết quả",
};
