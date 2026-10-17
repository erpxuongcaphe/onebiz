import type { Criterion, Person } from "./contracts";
import {
  parseMoneyUS,
  validateRewardPolicy,
  type RewardPolicy,
} from "./policy";

import type { ScheduleFrequency } from "./recurrence";
export type Frequency = ScheduleFrequency | "event";

export function validateCriteria(criteria: readonly Criterion[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  if (!criteria.length || criteria.length > 30)
    issues.push("Cần từ 1 đến 30 tiêu chí.");
  criteria.forEach((criterion, index) => {
    const prefix = `Tiêu chí ${index + 1}: `;
    if (ids.has(criterion.id) || !criterion.id)
      issues.push(prefix + "mã tiêu chí bị trùng hoặc thiếu.");
    ids.add(criterion.id);
    if (!criterion.title.trim()) issues.push(prefix + "chưa có tên.");
    if (!Number.isFinite(criterion.threshold))
      issues.push(prefix + "mức cần đạt không hợp lệ.");
    if (
      !Number.isInteger(criterion.samples) ||
      criterion.samples < 1 ||
      criterion.samples > 50
    )
      issues.push(prefix + "số lần kiểm tra phải từ 1 đến 50.");
    if (
      criterion.kind === "boolean" &&
      (criterion.operator !== "eq" || ![0, 1].includes(criterion.threshold))
    )
      issues.push(prefix + "kết quả Có/Không phải so sánh bằng Có hoặc Không.");
    const times = criterion.measurementTimes ?? [];
    if (
      times.length &&
      (times.length !== criterion.samples ||
        times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) ||
        new Set(times).size !== times.length)
    )
      issues.push(
        prefix +
          "giờ kiểm tra phải đầy đủ, không trùng và khớp số lần kiểm tra.",
      );
  });
  return issues;
}

export function applyCriterionReference(
  current: Criterion,
  reference: Criterion,
): Criterion {
  // Templates supply defaults, not the identity of a criterion in this standard.
  return {
    ...reference,
    id: current.id,
    measurementTimes: reference.measurementTimes
      ? [...reference.measurementTimes]
      : undefined,
  };
}

export function rewardPolicyFromForm(
  form: FormData,
  people: readonly Person[],
  tiers: RewardPolicy["tiers"],
  version: string,
): RewardPolicy {
  const percent = (key: string) => {
    const raw = String(form.get(key) ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
      throw new Error("Tỷ lệ phải là số không âm, tối đa hai số thập phân.");
    const [whole, fraction = ""] = raw.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  };
  const amount = (key: string) => {
    const value = parseMoneyUS(String(form.get(key) ?? ""));
    if (value === null)
      throw new Error(
        "Số tiền phải đúng dạng 1,234.56, tối đa hai số thập phân.",
      );
    return value;
  };
  const config: RewardPolicy = {
    version,
    state: "draft",
    subjectKind: "manager",
    operationsWeightBps: percent("opsWeight"),
    businessWeightBps: percent("businessWeight"),
    minimumOperationsBps: percent("minOps"),
    minimumBusinessBps: percent("minBusiness"),
    maximumBusinessContributionBps: percent("maxBusiness"),
    requireFullVerification: form.has("verify"),
    blockCriticalFailure: form.has("critical"),
    baseCents: amount("base"),
    capCents: amount("cap"),
    roundingCents: amount("round"),
    tiers,
    allocations: people
      .map((person) => ({
        userId: person.id,
        shareBps: percent(`share-${person.id}`),
      }))
      .filter((item) => item.shareBps > 0),
  };
  const issues = validateRewardPolicy(config);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(" "));
  return config;
}
