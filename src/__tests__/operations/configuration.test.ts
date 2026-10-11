import { describe, expect, it } from "vitest";
import {
  rewardPolicyFromForm,
  applyCriterionReference,
  validateCriteria,
} from "@/lib/operations/configuration";
import type { Criterion } from "@/lib/operations/contracts";

const criterion: Criterion = {
  id: "first",
  title: "Vệ sinh",
  kind: "boolean",
  operator: "eq",
  threshold: 1,
  samples: 2,
  critical: false,
  evidenceRequired: false,
};
const people = [{ id: "manager", name: "Quản lý" }];
const tiers = [
  { minimumScoreBps: 8000, payoutBps: 5000 },
  { minimumScoreBps: 9500, payoutBps: 10000 },
];
function form() {
  const result = new FormData();
  Object.entries({
    opsWeight: "60",
    businessWeight: "40",
    minOps: "80",
    minBusiness: "80",
    maxBusiness: "100",
    base: "1,000,000",
    cap: "1,000,000",
    round: "1,000",
    "share-manager": "100",
    verify: "on",
    critical: "on",
  }).forEach(([key, value]) => result.set(key, value));
  return result;
}
describe("CEO configuration", () => {
  it("preserves unique identity when the same reference is selected twice", () => {
    const a = applyCriterionReference(criterion, {
      ...criterion,
      id: "reference",
    });
    const b = applyCriterionReference(
      { ...criterion, id: "second" },
      { ...criterion, id: "reference" },
    );
    expect(a.id).toBe("first");
    expect(b.id).toBe("second");
    expect(validateCriteria([a, b])).toEqual([]);
  });
  it("rejects duplicate and missing identities", () => {
    expect(validateCriteria([criterion, criterion]).join(" ")).toContain(
      "trùng",
    );
    expect(validateCriteria([{ ...criterion, id: "" }]).join(" ")).toContain(
      "thiếu",
    );
  });
  it("rejects incomplete, duplicate or invalid times", () => {
    for (const times of [
      ["09:00"],
      ["09:00", "09:00"],
      ["09:00", "25:00"],
      ["", ""],
    ])
      expect(
        validateCriteria([{ ...criterion, measurementTimes: times }]).join(" "),
      ).toContain("giờ kiểm tra");
    expect(
      validateCriteria([
        { ...criterion, measurementTimes: ["09:00", "15:00"] },
      ]),
    ).toEqual([]);
  });
  it("allows flexible schedules without fixed times", () =>
    expect(validateCriteria([criterion])).toEqual([]));
  it("rejects invalid counts and boolean comparisons", () => {
    for (const samples of [0, 51, 1.5])
      expect(
        validateCriteria([{ ...criterion, samples }]).length,
      ).toBeGreaterThan(0);
    expect(
      validateCriteria([{ ...criterion, operator: "gte" }]).length,
    ).toBeGreaterThan(0);
    expect(
      validateCriteria([{ ...criterion, threshold: 2 }]).length,
    ).toBeGreaterThan(0);
  });
  it("parses US money without writing any financial records", () => {
    const config = rewardPolicyFromForm(form(), people, tiers, "version");
    expect(config.baseCents).toBe(100000000);
    expect(config.state).toBe("draft");
    expect(config.allocations).toEqual([
      { userId: "manager", shareBps: 10000 },
    ]);
  });
  it("parses decimal percentages exactly", () => {
    const fields = form();
    fields.set("opsWeight", "60.29");
    fields.set("businessWeight", "39.71");
    expect(
      rewardPolicyFromForm(fields, people, tiers, "version")
        .operationsWeightBps,
    ).toBe(6029);
  });
  it("rejects invalid money, missing percentage and excessive precision", () => {
    for (const [key, value] of [
      ["base", "1.000.000"],
      ["opsWeight", ""],
      ["opsWeight", "60.001"],
      ["base", "9007199254740991"],
    ]) {
      const fields = form();
      fields.set(key, value);
      expect(() => rewardPolicyFromForm(fields, people, tiers, "v")).toThrow();
    }
  });
  it("blocks saving when weights, allocation or tiers are wrong", () => {
    const weights = form();
    weights.set("opsWeight", "50");
    expect(() => rewardPolicyFromForm(weights, people, tiers, "v")).toThrow(
      "100%",
    );
    const share = form();
    share.set("share-manager", "99");
    expect(() => rewardPolicyFromForm(share, people, tiers, "v")).toThrow(
      "100%",
    );
    expect(() =>
      rewardPolicyFromForm(form(), people, [...tiers].reverse(), "v"),
    ).toThrow("tăng dần");
  });
});
