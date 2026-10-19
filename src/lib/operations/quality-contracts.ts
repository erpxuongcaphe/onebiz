import { z } from "zod";
import { qualityPeriodKey, type QualityPeriod } from "./quality-periods";

export const qualityActions = [
  "check",
  "issue",
  "issue_update",
  "issue_assign",
  "recheck",
  "department",
  "assignment",
  "qc_grant",
  "catalog",
  "catalog_import",
  "rule",
  "rule_approve",
  "qc_create",
  "qc_line",
  "qc_complete",
  "qc_correct",
  "accounting",
  "accounting_approve",
  "settle",
  "period",
  "group",
  "adhoc",
  "reference",
  "target",
  "revenue",
  "approve_revenue",
  "onebiz_revenue",
  "revenue_batch",
] as const;
export type QualityAction = (typeof qualityActions)[number];
const uuid = z.uuid();
const period = qualityPeriodKey;
export const qualityCommandSchema = z
  .object({
    action: z.enum(qualityActions),
    requestId: uuid,
    payload: z.object({ branchId: uuid }).catchall(z.unknown()),
  })
  .strict();
export const qualityReadSchema = z
  .object({
    branch: uuid,
    period,
    entity: uuid.nullable().default(null),
    kind: z
      .enum(["work", "adhoc", "issues", "qc", "settings", "report", "history", "overview", "references"])
      .default("work"),
    search: z.string().max(200).default(""),
    sourceType: z.enum(["", "product", "lot", "supplier", "purchase", "supplier_return"]).default(""),
    state: z.string().max(40).default(""),
    category: z.string().max(80).default(""),
    priority: z.string().max(40).default(""),
    assignee: uuid.nullable().default(null),
    operator: uuid.nullable().default(null),
    department: uuid.nullable().default(null),
    frequency: z.enum(["", "once", "daily", "weekly", "monthly", "quarterly", "yearly", "event"]).default(""),
    result: z.enum(["", "met", "unmet", "unknown"]).default(""),
    dateField: z
      .enum(["due", "created", "completed", "checked"])
      .default("due"),
    from: z.iso.datetime({ offset: true }).nullable().default(null),
    to: z.iso.datetime({ offset: true }).nullable().default(null),
    mine: z.enum(["true", "false"]).default("false"),
    overdue: z.enum(["true", "false"]).default("false"),
    periodRange: z.enum(["true", "false"]).default("false"),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .superRefine((v, ctx) => {
    if (
      !!v.from !== !!v.to ||
      (v.from && v.to && Date.parse(v.from) >= Date.parse(v.to))
    )
      ctx.addIssue({ code: "custom", message: "Chọn đủ khoảng ngày hợp lệ." });
  });

export interface QualityRule {
  baseScore: number;
  floorScore: number | null;
  capScore: number | null;
  repeatMode: "each_audit" | "once_per_issue" | null;
  minimumScore: number;
  thresholdBasis: "before_bonus" | "after_bonus" | null;
  allowAbove100: boolean | null;
  bonusCap: number | null;
  limits?: {
    floor: boolean;
    ceiling: boolean;
    bonus: boolean;
  };
  bonusLimits?: { familyId: string; maxAwards: number | null; maxPoints: number | null }[];
  openIssueAcrossPeriods?: "each_period" | "once_until_closed";
  qcFundCents: number | null;
  businessFundCents: number | null;
  businessThresholdBps: number | null;
  businessCapBps: number | null;
  blockBusinessOnCritical: boolean | null;
  allocations: { userId: string; shareBps: number }[];
}
export const draftQualityRule: QualityRule = {
  baseScore: 100,
  floorScore: null,
  capScore: null,
  repeatMode: null,
  minimumScore: 70,
  thresholdBasis: null,
  allowAbove100: null,
  bonusCap: null,
  qcFundCents: 200000000,
  businessFundCents: null,
  businessThresholdBps: null,
  businessCapBps: null,
  blockBusinessOnCritical: null,
  allocations: [],
};
export interface QualityItem {
  group_title?: string | null;
  id: string;
  family_id: string;
  standard_id: string;
  code: string;
  title: string;
  category: string;
  score_type: "deduct" | "bonus";
  weight: number;
  criteria: import("./contracts").Criterion[];
  effective_from: string;
  critical: boolean;
  accounting_required?: boolean;
  version: number;
}
export interface QualityCheck {
  id: string;
  run_id: string | null;
  result: string;
  actor_id: string;
  created_at: string;
  note: string;
  observations: import("./contracts").Observation[];
}
export interface QualityIssue {
  references?: { id: string; source_type: string; source_id: string; label: string; note: string; created_at: string }[];
  sources?: { id: string; qc_line_id: string | null; check_id: string | null; created_at: string }[];
  rechecks?: { id: string; result: string; note: string; evidence: string; actor_id: string; created_at: string }[];
  id: string;
  branch_id: string;
  todo_id: string;
  title: string;
  description: string;
  state: string;
  category: string;
  priority: string;
  assignee_id: string;
  operator_id: string | null;
  department_id: string | null;
  due_at: string;
  original_due_at: string;
  created_at: string;
  completed_at: string | null;
  resolution: string | null;
  collaborators: string[];
  version: number;
  recurrence_of: string | null;
}
export interface QualityAudit {
  id: string;
  title: string;
  period: string;
  state: "draft" | "completed";
  auditor_id: string;
  created_at: string;
  completed_at: string | null;
  rule_id: string | null;
  version: number;
}
export interface QualityLine {
  corrections?: { id: string; before_data: { result: string }; after_data: { result: string }; reason: string; evidence: string; actor_id: string; created_at: string }[];
  id: string;
  audit_id: string;
  item_snapshot: QualityItem;
  result: "unknown" | "met" | "unmet" | "excluded";
  observations: import("./contracts").Observation[];
  evidence: string;
  note: string;
  issue_ids: string[];
  version: number;
  critical: boolean;
}
export interface QualityWorkspace {
  periods?: QualityPeriod[];
  groups?: { id: string; title: string; active: boolean; version: number }[];
  target?: { amount_cents: number; definition: { label: string } } | null;
  revenues?: import('./contracts').Revenue[];
  adhoc?: (QualityCheck & { standard_snapshot: { title: string }; kind: 'adhoc' })[];
  compliance?: { due: number; checked: number; met: number; late?: number; unknown: number; overdue: number };
  issueSummary?: { opened: number; awaiting: number; overdue: number; closed: number };
  relatedBranches?: { id: string; name: string }[];
  business?: {
    ready: boolean;
    reason?: string;
    ratioBps?: number;
    rewardCents?: number;
    sourceName?: string;
    revenueCents?: number;
    targetCents?: number;
  };
  audit?: QualityAudit | null;
  can: {
    manage: boolean;
    work: boolean;
    qc: boolean;
    correct: boolean;
    accounting: boolean;
    close: boolean;
  };
  rows: Record<string, unknown>[];
  total: number;
  offset: number;
  limit: number;
  departments: {
    id: string;
    title: string;
    members: string[];
    active: boolean;
  }[];
  assignments: { family_id: string; manager_ids: string[] }[];
  grants: {
    user_id: string;
    can_audit: boolean;
    can_correct: boolean;
    can_accounting: boolean;
    active: boolean;
  }[];
  catalog: QualityItem[];
  rules: {
    id: string;
    title: string;
    state: string;
    effective_from: string;
    config: QualityRule;
  }[];
  score: {
    official: boolean;
    completedAudits: number;
    deductions: number;
    bonus: number;
    rawScore: number | null;
    score: number | null;
    critical: boolean;
    rewardReady: boolean;
    rewardCents: number | null;
    reasons: string[];
  };
  settlement: {
    id: string;
    revision: number;
    snapshot: Record<string, unknown>;
    created_at: string;
  } | null;
  accounting: {
    id: string;
    title: string;
    period: string;
    numerator: number;
    denominator: number;
    unit: string;
    evidence: string;
    state: string;
    version: number;
  }[];
}
