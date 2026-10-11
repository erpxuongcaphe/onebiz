import { describe, expect, it } from "vitest";
import {
  mayAct,
  parseMoneyUS,
  previewReward,
  previewAllocatedRewards,
  selectApprovedRevenue,
  summarizeOperations,
  validateRevenue,
  validateRewardPolicy,
  type DueResult,
  type PolicyActor,
  type RevenueSubmission,
  type RewardPolicy,
} from "@/lib/operations/policy";

const actor: PolicyActor = {
  userId: "ceo",
  tenantId: "t1",
  isCeo: true,
  effectivePermissions: [],
  grants: [],
};
const revenue: RevenueSubmission = {
  source: "manual",
  tenantId: "t1",
  branchId: "b1",
  period: "2026-10",
  definitionVersion: "v1",
  amountCents: 35000000000,
  externalSourceName: "Báo cáo POS ngoài",
  evidenceReference: "document-1",
  sourceRecordKey: "import-1",
  state: "approved",
};
const policy: RewardPolicy = {
  version: "v1",
  subjectKind: "manager",
  state: "approved",
  operationsWeightBps: 6000,
  businessWeightBps: 4000,
  minimumOperationsBps: 8000,
  minimumBusinessBps: 7000,
  maximumBusinessContributionBps: 10000,
  blockCriticalFailure: true,
  requireFullVerification: true,
  baseCents: 100000000,
  capCents: 150000000,
  roundingCents: 100,
  tiers: [
    { minimumScoreBps: 0, payoutBps: 0 },
    { minimumScoreBps: 8000, payoutBps: 5000 },
    { minimumScoreBps: 9000, payoutBps: 10000 },
  ],
};
const input = {
  operationsBps: 9000,
  businessBps: 8750,
  fullyVerified: true,
  criticalFailure: false,
};

describe("OneBiz operations scoped permissions", () => {
  it("starts with CEO access without new account types", () =>
    expect(mayAct(actor, "t1", "b1", "cancel_todo")).toBe(true));
  it("never allows cross-tenant CEO access", () =>
    expect(mayAct(actor, "t2", "b1", "verify")).toBe(false));
  it("prevents self verification even for CEO", () =>
    expect(mayAct(actor, "t1", "b1", "verify", "ceo")).toBe(false));
  it("delegates only the granted action and branch", () => {
    const lead = {
      ...actor,
      isCeo: false,
      effectivePermissions: ["ops.view", "ops.verify"],
      grants: [{ capability: "verify" as const, branchIds: ["b1"] }],
    };
    expect(mayAct(lead, "t1", "b1", "verify", "manager")).toBe(true);
    expect(mayAct(lead, "t1", "b2", "verify")).toBe(false);
    expect(mayAct(lead, "t1", "b1", "cancel_todo")).toBe(false);
  });
  it("does not turn branch assignment into a central permission", () => {
    const lead = { ...actor, isCeo: false, effectivePermissions: ["ops.view"],
      grants: [{ capability: "verify" as const, branchIds: ["b1"] }] };
    expect(mayAct(lead, "t1", "b1", "verify")).toBe(false);
    expect(mayAct({ ...lead, effectivePermissions: ["ops.verify"] }, "t1", "b1", "verify")).toBe(false);
  });
});

describe("strict external revenue input", () => {
  it.each([
    ["1,234.56", 123456],
    ["350000000", 35000000000],
    ["0", 0],
    ["-1,234.50", -123450],
    ["12.3", 1230],
  ])("parses US %s", (value, result) =>
    expect(parseMoneyUS(value as string)).toBe(result),
  );
  it.each([
    "1.234,56",
    "12,34",
    "1,23,456",
    "1.234",
    "1e6",
    "",
    "NaN",
    "Infinity",
    "99999999999999999",
    "01",
    "1,000.",
  ])("rejects ambiguous or unsafe %s", (value) =>
    expect(parseMoneyUS(value)).toBeNull(),
  );
  it("requires provenance for external sources", () => {
    expect(validateRevenue(revenue)).toEqual([]);
    expect(
      validateRevenue({
        ...revenue,
        evidenceReference: "",
        externalSourceName: "",
      }).map((item) => item.field),
    ).toEqual(["externalSourceName", "evidenceReference"]);
  });
  it("rejects invalid month and noninteger amounts", () =>
    expect(
      validateRevenue({ ...revenue, period: "2026-13", amountCents: 1.1 }),
    ).toHaveLength(2));
  it("does not mistake pending input for approved actual", () =>
    expect(
      selectApprovedRevenue([{ ...revenue, state: "pending" }]),
    ).toBeNull());
  it("does not add OneBiz and external revenue together", () =>
    expect(() =>
      selectApprovedRevenue([revenue, { ...revenue, source: "onebiz" }]),
    ).toThrow("nhiều nguồn"));
  it("rejects mixed branches and periods", () => {
    expect(() =>
      selectApprovedRevenue([
        revenue,
        { ...revenue, branchId: "b2", state: "draft" },
      ]),
    ).toThrow("Không được gộp");
    expect(() =>
      selectApprovedRevenue([
        revenue,
        { ...revenue, period: "2026-09", state: "draft" },
      ]),
    ).toThrow("Không được gộp");
  });
});

describe("original-deadline operations KPI", () => {
  const from = "2026-09-30T17:00:00Z",
    to = "2026-10-31T17:00:00Z",
    now = "2026-10-09T10:00:00Z";
  const result = (id: string, changes: Partial<DueResult> = {}): DueResult => ({
    id,
    originalDueAt: "2026-10-08T03:00:00Z",
    quality: "met",
    metAt: "2026-10-08T02:50:00Z",
    verified: true,
    exemptionApproved: false,
    ...changes,
  });
  it("keeps 7 of 10 at 70% after late remediation and two future tasks", () => {
    const rows = Array.from({ length: 7 }, (_, i) => result(String(i)));
    rows.push(
      result("late", { metAt: "2026-10-09T04:00:00Z" }),
      result("unmet", { quality: "unmet", metAt: null }),
      result("unknown", { quality: "unknown", metAt: null }),
      result("future1", { originalDueAt: "2026-10-10T03:00:00Z", metAt: null }),
      result("future2", { originalDueAt: "2026-10-11T03:00:00Z", metAt: null }),
    );
    expect(summarizeOperations(rows, from, to, now)).toMatchObject({
      due: 10,
      onTime: 7,
      late: 1,
      notDue: 2,
      unknown: 1,
      onTimePercent: 70,
    });
  });
  it("uses end-exclusive Vietnam boundaries", () =>
    expect(
      summarizeOperations(
        [
          result("end", { originalDueAt: to }),
          result("start", { originalDueAt: from, metAt: from }),
        ],
        from,
        to,
        now,
      ).due,
    ).toBe(1));
  it("returns no data rather than 100% for no due tasks", () =>
    expect(summarizeOperations([], from, to, now).onTimePercent).toBeNull());
  it("requires approved exemptions and does not double count", () => {
    expect(
      summarizeOperations(
        [result("skip", { exemptionApproved: true })],
        from,
        to,
        now,
      ).due,
    ).toBe(0);
    expect(() =>
      summarizeOperations([result("x"), result("x")], from, to, now),
    ).toThrow("Trùng");
  });
  it("rejects timezone-free timestamps", () =>
    expect(() =>
      summarizeOperations(
        [result("x", { originalDueAt: "2026-10-08T10:00:00" })],
        from,
        to,
        now,
      ),
    ).toThrow("múi giờ"));
  it("does not count a future completion as actual", () =>
    expect(
      summarizeOperations(
        [result("x", { metAt: "2026-10-10T04:00:00Z" })],
        from,
        to,
        now,
      ).late,
    ).toBe(0));
});

describe("configurable reward preview", () => {
  it("validates percentages and ascending tiers", () => {
    expect(validateRewardPolicy(policy)).toEqual([]);
    expect(
      validateRewardPolicy({ ...policy, businessWeightBps: 5000 }).some(
        (item) => item.field === "weights",
      ),
    ).toBe(true);
    expect(
      validateRewardPolicy({
        ...policy,
        tiers: [policy.tiers[1], policy.tiers[1]],
      }).some((item) => item.field === "tiers"),
    ).toBe(true);
  });
  it("does not invent an amount for missing or unapproved policy/data", () => {
    expect(previewReward({ ...policy, state: "draft" }, input).state).toBe(
      "unavailable",
    );
    expect(previewReward(policy, { ...input, businessBps: null }).state).toBe(
      "unavailable",
    );
    expect(
      previewReward(policy, { ...input, fullyVerified: false }).state,
    ).toBe("unavailable");
  });
  it("uses configurable weights and payout tiers", () =>
    expect(previewReward(policy, input)).toEqual({
      state: "calculated",
      scoreBps: 8900,
      amountCents: 50000000,
    }));
  it("caps business contribution at 100% so revenue cannot erase ops failure", () => {
    expect(
      previewReward(policy, {
        ...input,
        businessBps: 20000,
        operationsBps: 7000,
      }),
    ).toMatchObject({ amountCents: 0, scoreBps: 8200 });
  });
  it("supports a separately approved business contribution limit", () => {
    expect(
      previewReward(
        { ...policy, maximumBusinessContributionBps: 12000 },
        { ...input, businessBps: 15000 },
      ),
    ).toMatchObject({ scoreBps: 10200, amountCents: 100000000 });
  });
  it("blocks critical failures only when configured", () => {
    expect(
      previewReward(policy, { ...input, criticalFailure: true }),
    ).toMatchObject({ amountCents: 0 });
    expect(
      previewReward(
        { ...policy, blockCriticalFailure: false },
        { ...input, criticalFailure: true },
      ),
    ).toMatchObject({ amountCents: 50000000 });
  });
  it("rounds integer money then applies the hard cap", () =>
    expect(
      previewReward(
        { ...policy, baseCents: 101, capCents: 40, roundingCents: 10 },
        input,
      ),
    ).toMatchObject({ amountCents: 40 }));
  it("rounds only once so fractional cents cannot cross a rounding threshold", () =>
    expect(
      previewReward({ ...policy, baseCents: 99, roundingCents: 100 }, input),
    ).toMatchObject({ amountCents: 0 }));
  it("supports later subject kinds without enrolling employees now", () =>
    expect(
      validateRewardPolicy({ ...policy, subjectKind: "employee" }),
    ).toEqual([]));
  it("does not mutate versioned policy or actual input", () => {
    const before = JSON.stringify({ policy, input });
    previewReward(policy, input);
    expect(JSON.stringify({ policy, input })).toBe(before);
  });
  it("rejects duplicated recipients and allocations that do not total 100%", () => {
    expect(
      validateRewardPolicy({
        ...policy,
        allocations: [{ userId: "a", shareBps: 5000 }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateRewardPolicy({
        ...policy,
        allocations: [
          { userId: "a", shareBps: 5000 },
          { userId: "a", shareBps: 5000 },
        ],
      }).length,
    ).toBeGreaterThan(0);
  });
  it("allocates a single branch fund without paying the full fund twice", () => {
    const results = previewAllocatedRewards(
      {
        ...policy,
        allocations: [
          { userId: "a", shareBps: 6000 },
          { userId: "b", shareBps: 4000 },
        ],
      },
      new Map([
        ["a", input],
        ["b", input],
      ]),
    );
    expect(results.map((item) => item.result)).toMatchObject([
      { amountCents: 30000000 },
      { amountCents: 20000000 },
    ]);
  });
  it("keeps missing manager evidence unavailable instead of borrowing another manager's KPI", () => {
    const results = previewAllocatedRewards(
      {
        ...policy,
        allocations: [
          { userId: "a", shareBps: 6000 },
          { userId: "b", shareBps: 4000 },
        ],
      },
      new Map([["a", input]]),
    );
    expect(results[1].result.state).toBe("unavailable");
  });
});
