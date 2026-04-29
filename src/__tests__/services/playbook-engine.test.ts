import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase base + deps để import engine không lỗi module-init
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(), maybeSingle: vi.fn() })),
    })),
  }),
  getCurrentContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1" })),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (err: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${err.message}`);
  },
}));

vi.mock("@/lib/services/supabase/branches", () => ({
  getBranches: vi.fn(async () => []),
}));

// ai-agents exports đc playbook-engine dùng runtime — mock rỗng
vi.mock("@/lib/services/supabase/ai-agents", () => ({
  getAgents: vi.fn(async () => []),
  getKpiBreakdowns: vi.fn(async () => []),
  createAgentTask: vi.fn(async () => ({})),
}));

import {
  evaluateRule,
  getPlaybookRules,
  defaultPlaybookForRole,
} from "@/lib/services/supabase/playbook-engine";
import type {
  Agent,
  KpiBreakdown,
  PlaybookRule,
} from "@/lib/types/ai-agents";

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

function makeKpi(overrides: Partial<KpiBreakdown> = {}): KpiBreakdown {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 15); // 15 ngày trước
  const end = new Date(now);
  end.setDate(end.getDate() + 15); // 15 ngày nữa
  return {
    id: "kpi-1",
    tenantId: "t1",
    kpiName: "Doanh thu tháng 4",
    kpiType: "revenue",
    period: "monthly",
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    targetValue: 100_000_000,
    actualValue: 40_000_000,
    unit: "VND",
    metadata: {},
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<PlaybookRule> = {}): PlaybookRule {
  return {
    id: "r-1",
    name: "Test rule",
    kpiTypes: [],
    periods: [],
    trigger: "progress_low",
    triggerParams: { progressThresholdPct: 70, minElapsedPct: 50 },
    action: {
      titleTemplate: "Cảnh báo {kpiName}",
      priority: "high",
      dueOffsetDays: 1,
    },
    enabled: true,
    ...overrides,
  };
}

// ────────────────────────────────────────────
// evaluateRule
// ────────────────────────────────────────────

describe("evaluateRule — filter kpiTypes/periods", () => {
  it("không match khi kpiType không thuộc filter", () => {
    const kpi = makeKpi({ kpiType: "orders" });
    const rule = makeRule({ kpiTypes: ["revenue"] });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
    expect(r.reason).toContain("orders");
  });

  it("match khi kpiType rỗng = tất cả", () => {
    const kpi = makeKpi({ kpiType: "orders" });
    const rule = makeRule({ kpiTypes: [] });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
  });

  it("không match khi period không thuộc filter", () => {
    const kpi = makeKpi({ period: "weekly" });
    const rule = makeRule({ periods: ["monthly"] });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
    expect(r.reason).toContain("weekly");
  });

  it("match khi period rỗng = tất cả", () => {
    const kpi = makeKpi({ period: "weekly" });
    const rule = makeRule({ periods: [] });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
  });
});

describe("evaluateRule — progress_low", () => {
  it("match khi progress dưới ngưỡng và kỳ đã trôi đủ", () => {
    // Kỳ đã trôi 50% (15/30 ngày), progress = 40% → match ngưỡng 70% + minElapsed 50%
    const kpi = makeKpi({ actualValue: 40, targetValue: 100 });
    const rule = makeRule({
      trigger: "progress_low",
      triggerParams: { progressThresholdPct: 70, minElapsedPct: 50 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
    expect(r.taskPayload).toBeDefined();
    expect(r.taskPayload?.title).toContain("Doanh thu tháng 4");
  });

  it("không match khi kỳ mới chạy < minElapsedPct", () => {
    // Tạo kpi kỳ mới start hôm qua, kéo dài 30 ngày nữa → elapsed ~3%
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() + 29);
    const kpi = makeKpi({
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      actualValue: 0,
      targetValue: 100,
    });
    const rule = makeRule({
      trigger: "progress_low",
      triggerParams: { progressThresholdPct: 70, minElapsedPct: 50 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/chưa cảnh báo|min/i);
  });

  it("không match khi progress ≥ ngưỡng", () => {
    // Progress = 80% > 70% → không cần cảnh báo nữa
    const kpi = makeKpi({ actualValue: 80, targetValue: 100 });
    const rule = makeRule({
      trigger: "progress_low",
      triggerParams: { progressThresholdPct: 70, minElapsedPct: 50 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/đạt|vượt/i);
  });
});

describe("evaluateRule — progress_high", () => {
  it("match khi progress vượt ngưỡng", () => {
    const kpi = makeKpi({ actualValue: 110, targetValue: 100 });
    const rule = makeRule({
      trigger: "progress_high",
      triggerParams: { progressThresholdPct: 100 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
    expect(r.taskPayload).toBeDefined();
  });

  it("không match khi progress thấp hơn ngưỡng", () => {
    const kpi = makeKpi({ actualValue: 90, targetValue: 100 });
    const rule = makeRule({
      trigger: "progress_high",
      triggerParams: { progressThresholdPct: 100 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
  });
});

describe("evaluateRule — no_activity", () => {
  it("match khi qua N ngày và actual = 0", () => {
    // Kỳ start 5 ngày trước
    const start = new Date();
    start.setDate(start.getDate() - 5);
    const end = new Date();
    end.setDate(end.getDate() + 25);
    const kpi = makeKpi({
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      actualValue: 0,
    });
    const rule = makeRule({
      trigger: "no_activity",
      triggerParams: { firstNDays: 3 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
  });

  it("không match khi actual > 0", () => {
    const start = new Date();
    start.setDate(start.getDate() - 5);
    const kpi = makeKpi({
      periodStart: start.toISOString().slice(0, 10),
      actualValue: 100,
    });
    const rule = makeRule({
      trigger: "no_activity",
      triggerParams: { firstNDays: 3 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/hoạt động/i);
  });

  it("không match khi chưa đủ N ngày", () => {
    const start = new Date();
    start.setDate(start.getDate() - 1); // 1 ngày
    const kpi = makeKpi({
      periodStart: start.toISOString().slice(0, 10),
      actualValue: 0,
    });
    const rule = makeRule({
      trigger: "no_activity",
      triggerParams: { firstNDays: 3 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
  });
});

describe("evaluateRule — periodic_review", () => {
  it("match khi đúng mốc everyNDays", () => {
    // Kỳ start 7 ngày trước, everyNDays = 7 → daysPast = 7, 7 % 7 == 0 và >0
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const kpi = makeKpi({
      periodStart: start.toISOString().slice(0, 10),
    });
    const rule = makeRule({
      trigger: "periodic_review",
      triggerParams: { everyNDays: 7 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
    expect(r.reason).toMatch(/mốc review/i);
  });

  it("không match khi chưa tới mốc", () => {
    const start = new Date();
    start.setDate(start.getDate() - 3);
    const kpi = makeKpi({
      periodStart: start.toISOString().slice(0, 10),
    });
    const rule = makeRule({
      trigger: "periodic_review",
      triggerParams: { everyNDays: 7 },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(false);
  });
});

describe("evaluateRule — template rendering", () => {
  it("render {kpiName}, {progressPct}, {actual}, {target}, {unit}", () => {
    const kpi = makeKpi({
      kpiName: "Doanh thu Q2",
      actualValue: 50,
      targetValue: 100,
      unit: "triệu",
    });
    const rule = makeRule({
      trigger: "progress_low",
      triggerParams: { progressThresholdPct: 80, minElapsedPct: 30 },
      action: {
        titleTemplate:
          "{kpiName} mới {progressPct}%: {actual}/{target} {unit}",
        priority: "high",
      },
    });
    const r = evaluateRule(rule, kpi);
    expect(r.matched).toBe(true);
    expect(r.taskPayload?.title).toContain("Doanh thu Q2");
    expect(r.taskPayload?.title).toContain("50.0%");
    expect(r.taskPayload?.title).toContain("triệu");
  });

  it("dueDate = today + dueOffsetDays", () => {
    const kpi = makeKpi({ actualValue: 40, targetValue: 100 });
    const rule = makeRule({
      action: {
        titleTemplate: "X",
        priority: "normal",
        dueOffsetDays: 3,
      },
    });
    const r = evaluateRule(rule, kpi);
    const today = new Date();
    const expected = new Date(today);
    expected.setDate(expected.getDate() + 3);
    const y = expected.getFullYear();
    const m = String(expected.getMonth() + 1).padStart(2, "0");
    const d = String(expected.getDate()).padStart(2, "0");
    expect(r.taskPayload?.dueDate).toBe(`${y}-${m}-${d}`);
  });
});

// ────────────────────────────────────────────
// getPlaybookRules
// ────────────────────────────────────────────

describe("getPlaybookRules", () => {
  const agentBase: Omit<Agent, "config"> = {
    id: "a1",
    tenantId: "t1",
    code: "sales",
    name: "Sales agent",
    role: "sales",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("trả mảng rỗng khi agent không có playbook", () => {
    const agent: Agent = { ...agentBase, config: {} };
    expect(getPlaybookRules(agent)).toEqual([]);
  });

  it("parse đúng playbook[] từ config JSONB", () => {
    const agent: Agent = {
      ...agentBase,
      config: {
        playbook: [makeRule({ id: "r1" }), makeRule({ id: "r2" })],
      },
    };
    expect(getPlaybookRules(agent)).toHaveLength(2);
  });

  it("filter ra rule không đúng shape", () => {
    const agent: Agent = {
      ...agentBase,
      config: {
        playbook: [
          makeRule({ id: "valid" }),
          { id: "bad" }, // thiếu name, trigger
          null,
          "string",
        ],
      } as never,
    };
    const rules = getPlaybookRules(agent);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("valid");
  });
});

// ────────────────────────────────────────────
// defaultPlaybookForRole
// ────────────────────────────────────────────

describe("defaultPlaybookForRole", () => {
  it("sales — 2 rule", () => {
    const rules = defaultPlaybookForRole("sales");
    expect(rules.length).toBe(2);
    expect(rules.every((r) => r.enabled)).toBe(true);
    expect(rules[0].kpiTypes).toContain("revenue");
  });

  it("marketing — 1 rule periodic_review", () => {
    const rules = defaultPlaybookForRole("marketing");
    expect(rules.length).toBe(1);
    expect(rules[0].trigger).toBe("periodic_review");
  });

  it("operations — 1 rule no_activity", () => {
    const rules = defaultPlaybookForRole("operations");
    expect(rules.length).toBe(1);
    expect(rules[0].trigger).toBe("no_activity");
  });

  it("finance — 1 rule progress_low", () => {
    const rules = defaultPlaybookForRole("finance");
    expect(rules.length).toBe(1);
    expect(rules[0].trigger).toBe("progress_low");
  });

  it("ceo — 1 rule progress_high", () => {
    const rules = defaultPlaybookForRole("ceo");
    expect(rules.length).toBe(1);
    expect(rules[0].trigger).toBe("progress_high");
  });

  it("hr + custom + unknown — rỗng", () => {
    expect(defaultPlaybookForRole("hr")).toEqual([]);
    expect(defaultPlaybookForRole("custom")).toEqual([]);
    expect(defaultPlaybookForRole("unknown")).toEqual([]);
  });

  it("rule có id duy nhất", () => {
    const rules = defaultPlaybookForRole("sales");
    const ids = new Set(rules.map((r) => r.id));
    expect(ids.size).toBe(rules.length);
  });
});

// dùng beforeEach cho reset nếu cần mở rộng trong tương lai
beforeEach(() => {
  vi.clearAllMocks();
});
