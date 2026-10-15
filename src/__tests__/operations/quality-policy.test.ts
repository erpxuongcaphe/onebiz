import { describe, it, expect } from "vitest";
import {
  draftQualityRule,
  qualityReadSchema,
  qualityCommandSchema,
} from "@/lib/operations/quality-contracts";
import {
  previewQualityScore,
  qualityRuleIssues,
  evaluateQualityObservations,
} from "@/lib/operations/quality-policy";
import {
  parseQualityCatalog,
  qualityImportHeaders,
} from "@/lib/operations/quality-import";
const rule = {
  ...draftQualityRule,
  floorScore: 0,
  capScore: 100,
  bonusCap: 10,
  repeatMode: "once_per_issue" as const,
  thresholdBasis: "after_bonus" as const,
  allowAbove100: false,
  allocations: [{ userId: "manager", shareBps: 10000 }],
};
describe("Independent QC and reward policy", () => {
  it("never declares base 100 official without a completed audit", () => {
    expect(previewQualityScore(rule, [], 0)).toMatchObject({
      score: null,
      rewardCents: null,
      rawScore: null,
    });
  });
  it.each([
    [69, 0],
    [70, 140000000],
    [95, 190000000],
    [100, 200000000],
  ])("%s points pays cents %s", (score, reward) => {
    expect(
      previewQualityScore(rule, [{ delta: score - 100, critical: false }], 1)
        .rewardCents,
    ).toBe(reward);
  });
  it("does not silently configure incomplete rules", () => {
    expect(qualityRuleIssues(draftQualityRule).length).toBeGreaterThan(0);
    expect(previewQualityScore(draftQualityRule, [], 1).score).toBeNull();
  });
  it("fund/allocation missing does not block official score", () => {
    expect(
      previewQualityScore(
        { ...rule, qcFundCents: null, allocations: [] },
        [],
        1,
      ),
    ).toMatchObject({ score: 100, rewardCents: null });
  });
  it("critical disqualification survives high score and bonuses", () => {
    expect(
      previewQualityScore(rule, [{ delta: 5, critical: true }], 1),
    ).toMatchObject({ score: 100, critical: true, rewardCents: 0 });
  });
  it("no unauthorized over-100 payout", () => {
    expect(
      previewQualityScore(rule, [{ delta: 10, critical: false }], 1),
    ).toMatchObject({ rawScore: 110, score: 100, rewardCents: 200000000 });
  });
  it("program explicitly allows >100", () => {
    expect(
      previewQualityScore(
        { ...rule, capScore: 120, allowAbove100: true },
        [{ delta: 10, critical: false }],
        1,
      ),
    ).toMatchObject({ score: 110, rewardCents: 220000000 });
  });
  it("threshold before bonus differs from threshold after bonus", () => {
    const events = [
      { delta: -35, critical: false },
      { delta: 10, critical: false },
    ];
    expect(
      previewQualityScore(
        { ...rule, thresholdBasis: "before_bonus" },
        events,
        1,
      ).rewardCents,
    ).toBe(0);
    expect(previewQualityScore(rule, events, 1).rewardCents).toBe(150000000);
  });
  it("caps cumulative bonuses and floors score", () => {
    expect(
      previewQualityScore(
        rule,
        [
          { delta: 100, critical: false },
          { delta: -30, critical: false },
        ],
        1,
      ).score,
    ).toBe(80);
    expect(
      previewQualityScore(rule, [{ delta: -197, critical: false }], 1).score,
    ).toBe(0);
  });
  it("uses decimal money arithmetic", () => {
    expect(
      previewQualityScore(
        { ...rule, qcFundCents: 123456789 },
        [{ delta: -4.99, critical: false }],
        1,
      ).rewardCents,
    ).toBe(117296295);
  });
  it("rejects duplicate or partial allocation", () => {
    expect(
      qualityRuleIssues(
        { ...rule, allocations: [{ userId: "a", shareBps: 5000 }] },
        true,
      ).length,
    ).toBeGreaterThan(0);
  });
  it("all samples and required evidence must be present", () => {
    const c = [
      {
        id: "x",
        title: "Open/close",
        kind: "boolean" as const,
        operator: "eq" as const,
        threshold: 1,
        samples: 2,
        critical: false,
        evidenceRequired: true,
      },
    ];
    expect(
      evaluateQualityObservations(c, [
        { criterionId: "x", slot: "1", value: 1, evidence: "photo" },
      ]),
    ).toBe("unknown");
    expect(
      evaluateQualityObservations(c, [
        { criterionId: "x", slot: "1", value: 0, evidence: "photo" },
      ]),
    ).toBe("unmet");
  });
  it("0.7 is not below 0.7; ratios calculated from numerator/denominator", () => {
    const c = [
      {
        id: "x",
        title: "Hao hut",
        kind: "percent" as const,
        operator: "lt" as const,
        threshold: 0.7,
        samples: 1,
        critical: false,
        evidenceRequired: false,
      },
    ];
    expect(
      evaluateQualityObservations(c, [
        {
          criterionId: "x",
          slot: "1",
          value: 0,
          numerator: 7,
          denominator: 1000,
        },
      ]),
    ).toBe("unmet");
    expect(
      evaluateQualityObservations(c, [
        {
          criterionId: "x",
          slot: "1",
          value: 100,
          numerator: 6,
          denominator: 1000,
        },
      ]),
    ).toBe("met");
  });
});
describe("QC import strictly previews and reports row/column", () => {
  const row = [
    "QC-001",
    "11111111-1111-4111-8111-111111111111",
    "Vận hành",
    "Trừ",
    "5",
    "15/10/2026",
    "Không",
  ];
  it("normalizes valid catalog without relying on display title identity", () => {
    const r = parseQualityCatalog([qualityImportHeaders, row]);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      weight: 5,
      scoreType: "deduct",
      category: "operations",
      effectiveFrom: "2026-10-15",
    });
  });
  it.each(["1,5", "5.123", "NaN", ""])(
    "rejects ambiguous weight %s",
    (value) => {
      const r = [...row];
      r[4] = value;
      expect(
        parseQualityCatalog([qualityImportHeaders, r]).errors,
      ).toContainEqual(expect.objectContaining({ row: 2, column: "Trọng số" }));
    },
  );
  it.each(["−5", "-5"])("normalizes signed deduction %s", (value) => {
    const r = [...row];
    r[4] = value;
    const parsed = parseQualityCatalog([qualityImportHeaders, r]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].weight).toBe(5);
  });
  it("accepts plus sign only as positive weight", () => {
    const r = [...row];
    r[4] = "+5";
    expect(parseQualityCatalog([qualityImportHeaders, r]).errors).toEqual([]);
  });
  it("rejects duplicate codes even when names differ", () => {
    expect(
      parseQualityCatalog([qualityImportHeaders, row, row]).errors,
    ).toContainEqual(
      expect.objectContaining({ row: 3, column: "Mã tiêu chuẩn" }),
    );
  });
  it("rejects invalid calendar date", () => {
    const r = [...row];
    r[5] = "31/02/2026";
    expect(
      parseQualityCatalog([qualityImportHeaders, r]).errors.length,
    ).toBeGreaterThan(0);
  });
  it("rejects mismatched header rather than guessing", () => {
    expect(parseQualityCatalog([["STT"], row]).errors[0].row).toBe(1);
  });
});
describe("QC command and read boundaries", () => {
  const b = "11111111-1111-4111-8111-111111111111";
  it("rejects unknown commands", () => {
    expect(
      qualityCommandSchema.safeParse({
        action: "update_stock",
        requestId: b,
        payload: { branchId: b },
      }).success,
    ).toBe(false);
  });
  it("requires valid paired end-exclusive date ranges", () => {
    expect(
      qualityReadSchema.safeParse({
        branch: b,
        period: "2026-10",
        from: "2026-10-01T00:00:00+07:00",
      }).success,
    ).toBe(false);
    expect(
      qualityReadSchema.safeParse({
        branch: b,
        period: "2026-10",
        from: "2026-10-02T00:00:00+07:00",
        to: "2026-10-01T00:00:00+07:00",
      }).success,
    ).toBe(false);
  });
  it("bounds pagination", () => {
    expect(
      qualityReadSchema.safeParse({
        branch: b,
        period: "2026-10",
        offset: 100001,
      }).success,
    ).toBe(false);
  });
});
