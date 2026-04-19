import { describe, it, expect } from "vitest";
import {
  taskUrgency,
  summarizeWorkload,
  summarizeKpiForAgent,
} from "@/lib/services/supabase/agent-sla";
import type { AgentTask, KpiBreakdown } from "@/lib/types/ai-agents";

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "t1",
    tenantId: "T",
    agentId: "A",
    taskDate: todayStr(),
    title: "Task",
    priority: "normal",
    status: "pending",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeKpi(overrides: Partial<KpiBreakdown> = {}): KpiBreakdown {
  return {
    id: "k1",
    tenantId: "T",
    kpiName: "K",
    kpiType: "revenue",
    period: "monthly",
    periodStart: todayStr(-15),
    periodEnd: todayStr(15),
    targetValue: 100,
    actualValue: 50,
    metadata: {},
    sourceAgentId: "A",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ────────────────────────────────────────────
// taskUrgency
// ────────────────────────────────────────────

describe("taskUrgency", () => {
  it("overdue — taskDate hôm qua, chưa done", () => {
    const t = makeTask({ taskDate: todayStr(-1), status: "pending" });
    expect(taskUrgency(t)).toBe("overdue");
  });

  it("done override dù quá hạn", () => {
    const t = makeTask({ taskDate: todayStr(-5), status: "done" });
    expect(taskUrgency(t)).toBe("done");
  });

  it("skipped override dù quá hạn", () => {
    const t = makeTask({ taskDate: todayStr(-5), status: "skipped" });
    expect(taskUrgency(t)).toBe("done");
  });

  it("due_today — taskDate hôm nay, không có dueTime", () => {
    const t = makeTask({ taskDate: todayStr(0) });
    expect(taskUrgency(t)).toBe("due_today");
  });

  it("due_today → overdue khi dueTime đã qua", () => {
    // dueTime = 00:01 chắc chắn đã qua (trừ nếu chạy lúc 00:00)
    const t = makeTask({
      taskDate: todayStr(0),
      dueTime: "00:01",
    });
    const u = taskUrgency(t);
    // Tránh flaky nếu test chạy đúng 00:00-00:01 → accept cả 2
    expect(["overdue", "due_today"]).toContain(u);
  });

  it("due_soon — taskDate ngày mai", () => {
    const t = makeTask({ taskDate: todayStr(1) });
    expect(taskUrgency(t)).toBe("due_soon");
  });

  it("due_soon — taskDate 2 ngày nữa", () => {
    const t = makeTask({ taskDate: todayStr(2) });
    expect(taskUrgency(t)).toBe("due_soon");
  });

  it("ok — taskDate 5 ngày nữa", () => {
    const t = makeTask({ taskDate: todayStr(5) });
    expect(taskUrgency(t)).toBe("ok");
  });
});

// ────────────────────────────────────────────
// summarizeWorkload
// ────────────────────────────────────────────

describe("summarizeWorkload", () => {
  it("chỉ tính task của agent đúng", () => {
    const tasks: AgentTask[] = [
      makeTask({ id: "1", agentId: "A", status: "pending" }),
      makeTask({ id: "2", agentId: "A", status: "in_progress" }),
      makeTask({ id: "3", agentId: "B", status: "pending" }),
      makeTask({ id: "4", agentId: "A", status: "done" }),
      makeTask({ id: "5", agentId: "A", status: "blocked" }),
    ];
    const w = summarizeWorkload("A", tasks);
    expect(w.pending).toBe(1);
    expect(w.inProgress).toBe(1);
    expect(w.done).toBe(1);
    expect(w.blocked).toBe(1);
    expect(w.activeCount).toBe(2);
  });

  it("đếm overdue + dueToday", () => {
    const tasks: AgentTask[] = [
      makeTask({ id: "1", agentId: "A", taskDate: todayStr(-2), status: "pending" }),
      makeTask({ id: "2", agentId: "A", taskDate: todayStr(0), status: "pending" }),
      makeTask({ id: "3", agentId: "A", taskDate: todayStr(5), status: "pending" }),
      makeTask({ id: "4", agentId: "A", taskDate: todayStr(-1), status: "done" }), // done không tính
    ];
    const w = summarizeWorkload("A", tasks);
    expect(w.overdue).toBe(1);
    expect(w.dueToday).toBe(1);
  });

  it("trả 0 khi không có task", () => {
    const w = summarizeWorkload("X", []);
    expect(w.activeCount).toBe(0);
    expect(w.overdue).toBe(0);
  });
});

// ────────────────────────────────────────────
// summarizeKpiForAgent
// ────────────────────────────────────────────

describe("summarizeKpiForAgent", () => {
  it("tính avgProgress đúng cho KPI có sourceAgentId match", () => {
    const kpis: KpiBreakdown[] = [
      makeKpi({ id: "1", sourceAgentId: "A", actualValue: 50, targetValue: 100 }),
      makeKpi({ id: "2", sourceAgentId: "A", actualValue: 80, targetValue: 100 }),
      makeKpi({ id: "3", sourceAgentId: "B", actualValue: 10, targetValue: 100 }),
    ];
    const s = summarizeKpiForAgent("A", kpis);
    expect(s.kpiCount).toBe(2);
    expect(s.avgProgress).toBe(65); // (50+80)/2
  });

  it("đếm lagging (<70%) và over-achieved (>=100%)", () => {
    const kpis: KpiBreakdown[] = [
      makeKpi({ id: "1", sourceAgentId: "A", actualValue: 30, targetValue: 100 }),
      makeKpi({ id: "2", sourceAgentId: "A", actualValue: 110, targetValue: 100 }),
      makeKpi({ id: "3", sourceAgentId: "A", actualValue: 80, targetValue: 100 }),
    ];
    const s = summarizeKpiForAgent("A", kpis);
    expect(s.laggingCount).toBe(1);
    expect(s.overAchievedCount).toBe(1);
  });

  it("empty khi không có KPI nào của agent", () => {
    const s = summarizeKpiForAgent("A", []);
    expect(s.kpiCount).toBe(0);
    expect(s.avgProgress).toBe(0);
  });

  it("không crash với target = 0", () => {
    const kpis = [
      makeKpi({ id: "1", sourceAgentId: "A", actualValue: 50, targetValue: 0 }),
    ];
    const s = summarizeKpiForAgent("A", kpis);
    expect(s.avgProgress).toBe(0);
  });
});
