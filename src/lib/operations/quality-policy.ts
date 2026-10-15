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
    v !== null && Number.isFinite(v) && v >= min && v <= max && new Decimal(v).toDecimalPlaces(2).equals(v);
  if (!bounded(rule.baseScore, 0, 1000) || !bounded(rule.minimumScore, 0, 1000))
    errors.push("Điểm cơ sở/ngưỡng không hợp lệ.");
  const floor = rule.limits?.floor ?? true;
  const ceiling = rule.limits?.ceiling ?? true;
  const bonus = rule.limits?.bonus ?? true;
  if (rule.limits && Object.values(rule.limits).some((v) => typeof v !== "boolean"))
    errors.push("Chọn rõ giới hạn nào được áp dụng.");
  if ((floor && !bounded(rule.floorScore, 0, 1000)) ||
    (ceiling && !bounded(rule.capScore, 0, 1000)) ||
    (floor && ceiling && rule.floorScore! > rule.capScore!))
    errors.push("Cần sàn và trần điểm hợp lệ.");
  if (!["each_audit", "once_per_issue"].includes(rule.repeatMode ?? ""))
    errors.push("Chưa chọn quy tắc lỗi lặp.");
  if (!["before_bonus", "after_bonus"].includes(rule.thresholdBasis ?? ""))
    errors.push("Chưa chọn cách xét ngưỡng thưởng.");
  if (typeof rule.allowAbove100 !== "boolean")
    errors.push("Chưa chọn chương trình vượt 100.");
  if (rule.limits && floor && rule.allowAbove100 === false && rule.floorScore! > 100)
    errors.push("Sàn điểm không được vượt 100 khi chương trình không cho vượt 100.");
  if (bonus && !bounded(rule.bonusCap, 0, 1000))
    errors.push("Chưa có giới hạn điểm cộng.");
  if ((rule.limits || rule.openIssueAcrossPeriods !== undefined) &&
      !["each_period", "once_until_closed"].includes(rule.openIssueAcrossPeriods ?? ""))
    errors.push("Chọn cách tính lỗi còn mở qua kỳ mới.");
  if (rule.bonusLimits && (new Set(rule.bonusLimits.map((v) => v.familyId)).size !== rule.bonusLimits.length ||
    rule.bonusLimits.some((v) => !/^[0-9a-f-]{36}$/i.test(v.familyId) ||
      (v.maxAwards !== null && (!Number.isInteger(v.maxAwards) || v.maxAwards < 0 || v.maxAwards > 10000)) ||
      (v.maxPoints !== null && !bounded(v.maxPoints, 0, 1000)))))
    errors.push("Giới hạn từng hạng mục phải hợp lệ và không trùng mã.");
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
  events: readonly { delta: number; critical: boolean; familyId?: string }[],
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
  const awarded = new Map<string, { count: number; points: number }>();
  let appliedBonus = new Decimal(0);
  for (const event of events) {
    if (event.delta <= 0) continue;
    const limit = rule.bonusLimits?.find((v) => v.familyId === event.familyId);
    const used = awarded.get(event.familyId ?? "") ?? { count: 0, points: 0 };
    const points = limit?.maxAwards != null && used.count >= limit.maxAwards ? 0 :
      limit?.maxPoints != null ? Math.min(event.delta, Math.max(0, limit.maxPoints - used.points)) : event.delta;
    awarded.set(event.familyId ?? "", { count: used.count + 1, points: new Decimal(used.points).plus(points).toNumber() });
    appliedBonus = appliedBonus.plus(points);
  }
  const limitedBonus = rule.limits?.bonus === false ? appliedBonus.toNumber() : Math.min(appliedBonus.toNumber(), rule.bonusCap ?? 0);
  const score =
    !completedAudits || errors.length
      ? null
      : Math.max(
          rule.limits?.floor === false ? -Infinity : rule.floorScore!,
          Math.min(
            rule.allowAbove100 ? (rule.limits?.ceiling === false ? Infinity : rule.capScore!) : Math.min(rule.limits?.ceiling === false ? Infinity : rule.capScore!, 100),
            new Decimal(rule.baseScore)
              .plus(deductions)
              .plus(limitedBonus)
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
