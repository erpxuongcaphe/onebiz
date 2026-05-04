/**
 * Playbook Engine — Sprint AI-2
 *
 * Mỗi agent có 1 playbook (lưu trong agent.config.playbook[]). Playbook là tập hợp
 * rule mô tả "khi KPI gặp điều kiện X thì tự động tạo task Y cho role Z".
 *
 * Eval flow:
 *   1. Lấy tất cả KPI active + agents active
 *   2. Với mỗi agent → mỗi rule enabled:
 *      - Filter KPI theo kpiTypes + periods
 *      - Check trigger condition (progress_low/high/no_activity/periodic_review)
 *      - Nếu match: tạo AgentTask (dedup theo rule + kpi + today)
 *   3. Return summary { tasks_created, evals[] }
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { formatNumber } from "@/lib/format";
import {
  getAgents,
  getKpiBreakdowns,
  createAgentTask,
} from "./ai-agents";
import type {
  Agent,
  AgentPlaybookConfig,
  KpiBreakdown,
  PlaybookEvalResult,
  PlaybookRule,
  RunPlaybookResult,
} from "@/lib/types/ai-agents";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function progressPct(actual: number, target: number): number {
  if (target <= 0) return 0;
  return (actual / target) * 100;
}

/** Tính % thời gian đã trôi qua trong kỳ KPI (0-100) */
function elapsedPct(kpi: KpiBreakdown): number {
  const start = new Date(kpi.periodStart).getTime();
  const end = new Date(kpi.periodEnd).getTime();
  const now = Date.now();
  if (end <= start) return 100;
  if (now <= start) return 0;
  if (now >= end) return 100;
  return ((now - start) / (end - start)) * 100;
}

/** Tính số ngày đã trôi qua kể từ start */
function daysSinceStart(kpi: KpiBreakdown): number {
  const start = new Date(kpi.periodStart).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - start) / (86400 * 1000)));
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Render template {kpiName}, {progressPct}, {target}, {actual}, {periodLabel} */
function renderTemplate(
  template: string,
  kpi: KpiBreakdown,
  extras?: Record<string, string | number>,
): string {
  const progress = progressPct(kpi.actualValue, kpi.targetValue);
  const ctx: Record<string, string> = {
    kpiName: kpi.kpiName,
    progressPct: progress.toFixed(1),
    target: formatNumber(kpi.targetValue),
    actual: formatNumber(kpi.actualValue),
    unit: kpi.unit ?? "",
    period: kpi.period,
    ...Object.fromEntries(
      Object.entries(extras ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  };
  return template.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? `{${k}}`);
}

/** Parse agent.config.playbook[] (dạng JSONB) ra array PlaybookRule */
export function getPlaybookRules(agent: Agent): PlaybookRule[] {
  const cfg = agent.config as AgentPlaybookConfig;
  if (!cfg || !Array.isArray(cfg.playbook)) return [];
  return cfg.playbook.filter(
    (r): r is PlaybookRule =>
      typeof r === "object" &&
      r !== null &&
      typeof r.id === "string" &&
      typeof r.name === "string" &&
      typeof r.trigger === "string",
  );
}

// ────────────────────────────────────────────
// Rule evaluation
// ────────────────────────────────────────────

/** Evaluate 1 rule đối với 1 KPI — trả PlaybookEvalResult */
export function evaluateRule(
  rule: PlaybookRule,
  kpi: KpiBreakdown,
): PlaybookEvalResult {
  // Filter theo kpiTypes/periods
  if (rule.kpiTypes.length > 0 && !rule.kpiTypes.includes(kpi.kpiType)) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      kpiId: kpi.id,
      kpiName: kpi.kpiName,
      matched: false,
      reason: `KPI type "${kpi.kpiType}" không thuộc filter rule`,
    };
  }
  if (rule.periods.length > 0 && !rule.periods.includes(kpi.period)) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      kpiId: kpi.id,
      kpiName: kpi.kpiName,
      matched: false,
      reason: `KPI period "${kpi.period}" không thuộc filter rule`,
    };
  }

  const progress = progressPct(kpi.actualValue, kpi.targetValue);
  const elapsed = elapsedPct(kpi);

  let matched = false;
  let reason = "";

  if (rule.trigger === "progress_low") {
    const threshold = rule.triggerParams.progressThresholdPct ?? 70;
    const minElapsed = rule.triggerParams.minElapsedPct ?? 50;
    if (elapsed < minElapsed) {
      reason = `Kỳ mới trôi ${elapsed.toFixed(0)}% (< ${minElapsed}% min), chưa cảnh báo`;
    } else if (progress >= threshold) {
      reason = `Tiến độ ${progress.toFixed(0)}% đã đạt/vượt ngưỡng ${threshold}%`;
    } else {
      matched = true;
      reason = `Tiến độ ${progress.toFixed(0)}% < ${threshold}% sau ${elapsed.toFixed(0)}% thời gian`;
    }
  } else if (rule.trigger === "progress_high") {
    const threshold = rule.triggerParams.progressThresholdPct ?? 100;
    if (progress >= threshold) {
      matched = true;
      reason = `Tiến độ ${progress.toFixed(0)}% ≥ ${threshold}%`;
    } else {
      reason = `Tiến độ ${progress.toFixed(0)}% chưa đạt ngưỡng ${threshold}%`;
    }
  } else if (rule.trigger === "no_activity") {
    const firstN = rule.triggerParams.firstNDays ?? 3;
    const daysPast = daysSinceStart(kpi);
    if (daysPast >= firstN && kpi.actualValue === 0) {
      matched = true;
      reason = `Đã qua ${daysPast} ngày (≥ ${firstN}) mà actual vẫn = 0`;
    } else if (kpi.actualValue > 0) {
      reason = `Đã có hoạt động (actual > 0)`;
    } else {
      reason = `Mới qua ${daysPast} ngày, chưa đủ ${firstN} ngày cảnh báo`;
    }
  } else if (rule.trigger === "periodic_review") {
    const every = rule.triggerParams.everyNDays ?? 7;
    const daysPast = daysSinceStart(kpi);
    if (daysPast > 0 && daysPast % every === 0) {
      matched = true;
      reason = `Đúng mốc review: ngày thứ ${daysPast} (mỗi ${every} ngày)`;
    } else {
      const nextMark = Math.ceil(daysPast / every) * every;
      reason = `Chưa tới mốc review: ngày ${daysPast}, mốc tiếp theo ngày ${nextMark}`;
    }
  }

  if (!matched) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      kpiId: kpi.id,
      kpiName: kpi.kpiName,
      matched: false,
      reason,
    };
  }

  // Build task payload
  const title = renderTemplate(rule.action.titleTemplate, kpi);
  const description = rule.action.descriptionTemplate
    ? renderTemplate(rule.action.descriptionTemplate, kpi)
    : undefined;
  const dueDate = addDaysIso(todayIso(), rule.action.dueOffsetDays ?? 0);

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    kpiId: kpi.id,
    kpiName: kpi.kpiName,
    matched: true,
    reason,
    taskPayload: {
      title,
      description,
      priority: rule.action.priority,
      assignedToRole: rule.action.assignedToRole,
      dueDate,
      kpiBreakdownId: kpi.id,
    },
  };
}

// ────────────────────────────────────────────
// Run — with dedup
// ────────────────────────────────────────────

/**
 * Kiểm tra task đã tồn tại cho (agent_id, kpi_breakdown_id, metadata.rule_id, task_date)
 * để không tạo trùng trong 1 ngày.
 */
async function existsTaskForRuleToday(
  agentId: string,
  kpiId: string,
  ruleId: string,
  taskDate: string,
): Promise<boolean> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("agent_tasks")
    .select("id")
    .eq("agent_id", agentId)
    .eq("kpi_breakdown_id", kpiId)
    .eq("task_date", taskDate)
    .contains("metadata", { rule_id: ruleId } as never)
    .limit(1);
  if (error) handleError(error, "existsTaskForRuleToday");
  return (data ?? []).length > 0;
}

/** Chạy toàn bộ playbook của 1 agent trên tất cả KPI */
export async function runPlaybookForAgent(
  agent: Agent,
  kpis?: KpiBreakdown[],
): Promise<RunPlaybookResult> {
  const rules = getPlaybookRules(agent).filter((r) => r.enabled);
  const allKpis = kpis ?? (await getKpiBreakdowns());
  const today = todayIso();

  const evals: PlaybookEvalResult[] = [];
  let created = 0;
  let skipped = 0;

  for (const rule of rules) {
    for (const kpi of allKpis) {
      const ev = evaluateRule(rule, kpi);
      evals.push(ev);
      if (!ev.matched || !ev.taskPayload) continue;

      // Dedup
      const exists = await existsTaskForRuleToday(
        agent.id,
        kpi.id,
        rule.id,
        today,
      );
      if (exists) {
        skipped += 1;
        ev.reason += ` — đã tạo task hôm nay, bỏ qua`;
        continue;
      }

      try {
        await createAgentTask({
          agentId: agent.id,
          kpiBreakdownId: ev.taskPayload.kpiBreakdownId,
          taskDate: today,
          title: ev.taskPayload.title,
          description: ev.taskPayload.description,
          priority: ev.taskPayload.priority,
          assignedToRole: ev.taskPayload.assignedToRole,
          dueTime: ev.taskPayload.dueDate,
          metadata: {
            rule_id: rule.id,
            rule_name: rule.name,
            generated_by: "playbook-engine",
            triggered_at: new Date().toISOString(),
          },
        });
        created += 1;
      } catch (err) {
        ev.matched = false;
        ev.reason = `Lỗi tạo task: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    rulesEvaluated: rules.length,
    kpisScanned: allKpis.length,
    tasksCreated: created,
    skipped,
    evals,
  };
}

/** Chạy playbook cho tất cả agent đang hoạt động */
export async function runAllPlaybooks(): Promise<RunPlaybookResult[]> {
  await getCurrentContext(); // ensure tenant
  const agents = await getAgents();
  const active = agents.filter((a) => a.isActive);
  const kpis = await getKpiBreakdowns();

  const results: RunPlaybookResult[] = [];
  for (const agent of active) {
    const rules = getPlaybookRules(agent).filter((r) => r.enabled);
    if (rules.length === 0) continue;
    const r = await runPlaybookForAgent(agent, kpis);
    results.push(r);
  }
  return results;
}

// ────────────────────────────────────────────
// Playbook CRUD on agent.config
// ────────────────────────────────────────────

/** Cập nhật toàn bộ playbook[] trên agent.config (merge với config hiện có) */
export async function savePlaybookRules(
  agentId: string,
  rules: PlaybookRule[],
): Promise<void> {
  const supabase = getClient();
  const { data: row, error: getErr } = await supabase
    .from("agents")
    .select("config")
    .eq("id", agentId)
    .maybeSingle();
  if (getErr) handleError(getErr, "savePlaybookRules.get");
  const existingCfg =
    (row?.config as Record<string, unknown> | null) ?? {};
  const nextCfg = { ...existingCfg, playbook: rules };

  const { error } = await supabase
    .from("agents")
    .update({ config: nextCfg as never })
    .eq("id", agentId);
  if (error) handleError(error, "savePlaybookRules.update");
}

// ────────────────────────────────────────────
// Default playbook templates per role
// ────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Rule set mẫu mà anh CEO có thể paste luôn cho agent mới */
export function defaultPlaybookForRole(role: string): PlaybookRule[] {
  switch (role) {
    case "sales":
      return [
        {
          id: genId("r"),
          name: "Doanh thu tháng chậm — nhắc đẩy promo",
          kpiTypes: ["revenue"],
          periods: ["monthly"],
          trigger: "progress_low",
          triggerParams: { progressThresholdPct: 70, minElapsedPct: 50 },
          action: {
            titleTemplate:
              "Doanh thu {kpiName} mới đạt {progressPct}% — đẩy combo/promo",
            descriptionTemplate:
              "Actual {actual} {unit} / target {target} {unit}. Đề xuất triển khai coupon Flash Sale cuối tuần.",
            priority: "high",
            assignedToRole: "manager",
            dueOffsetDays: 1,
          },
          enabled: true,
        },
        {
          id: genId("r"),
          name: "Tuần chưa có đơn nào — kiểm tra pipeline",
          kpiTypes: ["orders"],
          periods: ["weekly"],
          trigger: "no_activity",
          triggerParams: { firstNDays: 2 },
          action: {
            titleTemplate: "KPI {kpiName} chưa có đơn hàng",
            priority: "urgent",
            assignedToRole: "sales-lead",
            dueOffsetDays: 0,
          },
          enabled: true,
        },
      ];

    case "marketing":
      return [
        {
          id: genId("r"),
          name: "Review content mỗi 7 ngày",
          kpiTypes: ["customers"],
          periods: ["monthly", "quarterly"],
          trigger: "periodic_review",
          triggerParams: { everyNDays: 7 },
          action: {
            titleTemplate: "Review content tuần — KPI {kpiName}",
            descriptionTemplate:
              "Hiện {progressPct}% target. Rà soát bài đăng social + quảng cáo tuần qua.",
            priority: "normal",
            assignedToRole: "marketing-exec",
            dueOffsetDays: 1,
          },
          enabled: true,
        },
      ];

    case "operations":
      return [
        {
          id: genId("r"),
          name: "Tồn kho không đổi 3 ngày — kiểm kê",
          kpiTypes: ["inventory"],
          periods: ["weekly", "monthly"],
          trigger: "no_activity",
          triggerParams: { firstNDays: 3 },
          action: {
            titleTemplate: "Kiểm kê tồn kho {kpiName}",
            priority: "normal",
            assignedToRole: "warehouse-manager",
            dueOffsetDays: 0,
          },
          enabled: true,
        },
      ];

    case "finance":
      return [
        {
          id: genId("r"),
          name: "Lợi nhuận tháng chậm — rà soát chi phí",
          kpiTypes: ["profit"],
          periods: ["monthly", "quarterly"],
          trigger: "progress_low",
          triggerParams: { progressThresholdPct: 60, minElapsedPct: 60 },
          action: {
            titleTemplate: "Rà soát chi phí — {kpiName} mới đạt {progressPct}%",
            priority: "high",
            assignedToRole: "accountant",
            dueOffsetDays: 2,
          },
          enabled: true,
        },
      ];

    case "ceo":
      return [
        {
          id: genId("r"),
          name: "Mừng vượt target — họp chia sẻ cách làm",
          kpiTypes: [],
          periods: ["monthly"],
          trigger: "progress_high",
          triggerParams: { progressThresholdPct: 110 },
          action: {
            titleTemplate:
              "🎉 {kpiName} vượt {progressPct}% — họp chia sẻ cách làm",
            priority: "normal",
            assignedToRole: "manager",
            dueOffsetDays: 3,
          },
          enabled: true,
        },
      ];

    case "hr":
      return [];

    default:
      return [];
  }
}
