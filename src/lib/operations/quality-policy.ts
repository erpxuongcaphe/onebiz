import Decimal from "decimal.js-light";
import type { QualityRule } from "./quality-contracts";
import type { Criterion, Observation } from "./contracts";

export function evaluateQualityObservations(
  criteria: readonly Criterion[],
  observations: readonly Observation[],
) {
  let missing = false,
    failed = false;
  for (const c of criteria)
    for (let i = 1; i <= c.samples; i++) {
      const o = observations.find(
        (v) => v.criterionId === c.id && v.slot === String(i),
      );
      if (
        !o ||
        !Number.isFinite(o.value) ||
        (c.evidenceRequired && !o.evidence?.trim())
      ) {
        missing = true;
        continue;
      }
      const v =
        c.kind === "percent"
          ? typeof o.numerator === "number" &&
            typeof o.denominator === "number" &&
            o.denominator > 0
            ? (o.numerator / o.denominator) * 100
            : NaN
          : o.value;
      if (!Number.isFinite(v)) {
        missing = true;
        continue;
      }
      const pass =
        c.operator === "eq"
          ? v === c.threshold
          : c.operator === "lt"
            ? v < c.threshold
            : c.operator === "lte"
              ? v <= c.threshold
              : v >= c.threshold;
      if (!pass) failed = true;
    }
  return failed ? "unmet" : missing ? "unknown" : "met";
}

export function qualityRuleIssues(rule: QualityRule, reward = false): string[] {
  const errors: string[] = [];
  const bounded = (v: number | null, min: number, max: number) =>
    v !== null && Number.isFinite(v) && v >= min && v <= max;
  if (!bounded(rule.baseScore, 0, 1000) || !bounded(rule.minimumScore, 0, 1000))
    errors.push("Điểm cơ sở/ngưỡng không hợp lệ.");
  if (
    !bounded(rule.floorScore, 0, 1000) ||
    !bounded(rule.capScore, 0, 1000) ||
    rule.floorScore! > rule.capScore!
  )
    errors.push("Cần sàn và trần điểm hợp lệ.");
  if (!["each_audit", "once_per_issue"].includes(rule.repeatMode ?? ""))
    errors.push("Chưa chọn quy tắc lỗi lặp.");
  if (!["before_bonus", "after_bonus"].includes(rule.thresholdBasis ?? ""))
    errors.push("Chưa chọn cách xét ngưỡng thưởng.");
  if (typeof rule.allowAbove100 !== "boolean")
    errors.push("Chưa chọn chương trình vượt 100.");
  if (!bounded(rule.bonusCap, 0, 1000))
    errors.push("Chưa có giới hạn điểm cộng.");
  if (reward) {
    if (!Number.isSafeInteger(rule.qcFundCents) || rule.qcFundCents! < 0)
      errors.push("Chưa có quỹ thưởng QC hợp lệ.");
    if (
      !rule.allocations.length ||
      rule.allocations.some(
        (a) => !a.userId || !Number.isInteger(a.shareBps) || a.shareBps <= 0,
      ) ||
      new Set(rule.allocations.map((a) => a.userId)).size !==
        rule.allocations.length ||
      rule.allocations.reduce((s, a) => s + a.shareBps, 0) !== 10000
    )
      errors.push("Phân bổ phải đủ 100%, mỗi người một dòng.");
  }
  return errors;
}

export function previewQualityScore(
  rule: QualityRule,
  events: readonly { delta: number; critical: boolean }[],
  completedAudits: number,
) {
  if (events.some((e) => !Number.isFinite(e.delta)))
    throw new Error("Điểm không hợp lệ.");
  const deductions = events
    .filter((e) => e.delta < 0)
    .reduce((s, e) => s.plus(e.delta), new Decimal(0));
  const bonus = events
    .filter((e) => e.delta > 0)
    .reduce((s, e) => s.plus(e.delta), new Decimal(0));
  const rawScore = new Decimal(rule.baseScore)
    .plus(deductions)
    .plus(bonus)
    .toNumber();
  const errors = qualityRuleIssues(rule);
  const score =
    !completedAudits || errors.length
      ? null
      : Math.max(
          rule.floorScore!,
          Math.min(
            rule.allowAbove100 ? rule.capScore! : Math.min(rule.capScore!, 100),
            new Decimal(rule.baseScore)
              .plus(deductions)
              .plus(Math.min(bonus.toNumber(), rule.bonusCap!))
              .toNumber(),
          ),
        );
  const critical = events.some((e) => e.critical);
  const rewardErrors = qualityRuleIssues(rule, true);
  const threshold =
    rule.thresholdBasis === "before_bonus"
      ? new Decimal(rule.baseScore).plus(deductions).toNumber()
      : score;
  return {
    rawScore: completedAudits ? rawScore : null,
    score,
    critical,
    deductions: deductions.toNumber(),
    bonus: bonus.toNumber(),
    rewardCents:
      score === null || rewardErrors.length
        ? null
        : critical || threshold! < rule.minimumScore
          ? 0
          : new Decimal(score)
              .times(rule.qcFundCents!)
              .div(100)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber(),
    reasons: !completedAudits ? ["Chưa có kết quả QC."] : rewardErrors,
  };
}
