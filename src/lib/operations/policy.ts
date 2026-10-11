/** Pure policy rules. No database writes, account creation, or payroll posting. */
import { hasOperationsPermission } from "./permissions";
export type RevenueSource = "onebiz" | "manual" | "xlsx";
export type SubjectKind = "manager" | "employee" | "position";
export type Capability =
  "verify" | "close_period" | "cancel_todo" | "approve_policy";

export interface PolicyActor {
  userId: string;
  tenantId: string;
  isCeo: boolean;
  effectivePermissions: readonly string[];
  grants: ReadonlyArray<{
    capability: Capability;
    branchIds: readonly string[];
  }>;
}

export function mayAct(
  actor: PolicyActor,
  tenantId: string,
  branchId: string,
  capability: Capability,
  subjectUserId?: string,
): boolean {
  if (actor.tenantId !== tenantId) return false;
  if (capability === "verify" && actor.userId === subjectUserId) return false;
  return (
    actor.isCeo ||
    (hasOperationsPermission(actor.effectivePermissions, capability) && actor.grants.some(
      (grant) =>
        grant.capability === capability && grant.branchIds.includes(branchId),
    ))
  );
}

export interface ValidationIssue {
  field: string;
  message: string;
}

// Do not strip separators blindly: a Vietnamese-formatted amount is ambiguous.
export function parseMoneyUS(value: string): number | null {
  const clean = value.trim();
  if (!/^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(clean))
    return null;
  const negative = clean.startsWith("-");
  const [whole, fraction = ""] = clean
    .replace(/^-/, "")
    .replace(/,/g, "")
    .split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}

export interface RevenueSubmission {
  source: RevenueSource;
  tenantId: string;
  branchId: string;
  period: string;
  definitionVersion: string;
  amountCents: number;
  evidenceReference?: string;
  externalSourceName?: string;
  sourceRecordKey: string;
  state: "draft" | "pending" | "approved";
}

export function validateRevenue(entry: RevenueSubmission): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of [
    "tenantId",
    "branchId",
    "definitionVersion",
    "sourceRecordKey",
  ] as const) {
    if (!entry[field].trim())
      issues.push({ field, message: "Thông tin bắt buộc chưa được điền." });
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.period)) {
    issues.push({
      field: "period",
      message: "Kỳ phải có tháng và năm hợp lệ.",
    });
  }
  if (!Number.isSafeInteger(entry.amountCents)) {
    issues.push({
      field: "amountCents",
      message: "Số tiền không hợp lệ hoặc vượt giới hạn.",
    });
  }
  if (entry.source !== "onebiz") {
    if (!entry.externalSourceName?.trim())
      issues.push({
        field: "externalSourceName",
        message: "Cần tên nguồn doanh thu bên ngoài.",
      });
    if (!entry.evidenceReference?.trim())
      issues.push({
        field: "evidenceReference",
        message: "Cần tài liệu đối chiếu cho doanh thu ngoài OneBiz.",
      });
  }
  return issues;
}

export function selectApprovedRevenue(
  entries: readonly RevenueSubmission[],
): RevenueSubmission | null {
  if (entries.some((entry) => validateRevenue(entry).length))
    throw new Error("Dữ liệu doanh thu chưa hợp lệ.");
  const approved = entries.filter((entry) => entry.state === "approved");
  if (!approved.length) return null;
  const [first] = approved;
  if (
    entries.some(
      (entry) =>
        entry.tenantId !== first.tenantId ||
        entry.branchId !== first.branchId ||
        entry.period !== first.period,
    )
  ) {
    throw new Error(
      "Không được gộp doanh thu khác doanh nghiệp, chi nhánh hoặc kỳ.",
    );
  }
  if (approved.length !== 1)
    throw new Error(
      "Có nhiều nguồn đã duyệt cho cùng kỳ; cần chọn một nguồn chính.",
    );
  return first;
}

export interface DueResult {
  id: string;
  originalDueAt: string;
  quality: "met" | "unmet" | "unknown";
  metAt: string | null;
  verified: boolean;
  exemptionApproved: boolean;
}

function timestamp(value: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error("Thời điểm phải có múi giờ.");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Thời điểm không hợp lệ.");
  return parsed;
}

export function summarizeOperations(
  results: readonly DueResult[],
  from: string,
  toExclusive: string,
  now: string,
) {
  const start = timestamp(from),
    end = timestamp(toExclusive),
    current = timestamp(now);
  if (start >= end) throw new Error("Khoảng kỳ không hợp lệ.");
  const seen = new Set<string>();
  let due = 0,
    onTime = 0,
    late = 0,
    unknown = 0,
    verified = 0,
    notDue = 0;
  for (const result of results) {
    if (seen.has(result.id)) throw new Error("Trùng lần thực hiện công việc.");
    seen.add(result.id);
    const deadline = timestamp(result.originalDueAt);
    const completed = result.metAt === null ? null : timestamp(result.metAt);
    if (deadline < start || deadline >= end || result.exemptionApproved)
      continue;
    if (deadline > current) {
      notDue++;
      continue;
    }
    due++;
    if (result.verified) verified++;
    if (result.quality === "unknown") unknown++;
    if (
      result.quality === "met" &&
      completed !== null &&
      completed <= current
    ) {
      if (completed <= deadline) onTime++;
      else late++;
    }
  }
  return {
    due,
    onTime,
    late,
    unknown,
    verified,
    notDue,
    onTimePercent: due ? (onTime / due) * 100 : null,
  };
}

export interface RewardPolicy {
  version: string;
  subjectKind: SubjectKind;
  state: "draft" | "approved";
  operationsWeightBps: number;
  businessWeightBps: number;
  minimumOperationsBps: number;
  minimumBusinessBps: number;
  maximumBusinessContributionBps: number;
  blockCriticalFailure: boolean;
  requireFullVerification: boolean;
  baseCents: number;
  capCents: number;
  roundingCents: number;
  tiers: readonly { minimumScoreBps: number; payoutBps: number }[];
  allocations?: readonly { userId: string; shareBps: number }[];
}

export function validateRewardPolicy(policy: RewardPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!policy.version.trim())
    issues.push({ field: "version", message: "Thiếu phiên bản chính sách." });
  for (const field of [
    "operationsWeightBps",
    "businessWeightBps",
    "minimumOperationsBps",
    "minimumBusinessBps",
  ] as const) {
    if (
      !Number.isInteger(policy[field]) ||
      policy[field] < 0 ||
      policy[field] > 10_000
    ) {
      issues.push({
        field,
        message: "Tỷ lệ phải nằm trong khoảng 0 đến 100%.",
      });
    }
  }
  if (policy.operationsWeightBps + policy.businessWeightBps !== 10_000) {
    issues.push({
      field: "weights",
      message: "Tổng trọng số vận hành và kinh doanh phải bằng 100%.",
    });
  }
  if (
    !Number.isInteger(policy.maximumBusinessContributionBps) ||
    policy.maximumBusinessContributionBps < 0 ||
    policy.maximumBusinessContributionBps > 100_000
  ) {
    issues.push({
      field: "maximumBusinessContributionBps",
      message: "Giới hạn đóng góp kinh doanh phải từ 0 đến 1,000%.",
    });
  }
  for (const field of ["baseCents", "capCents", "roundingCents"] as const) {
    if (
      !Number.isSafeInteger(policy[field]) ||
      policy[field] < (field === "roundingCents" ? 1 : 0)
    ) {
      issues.push({
        field,
        message: "Số tiền hoặc mức làm tròn không hợp lệ.",
      });
    }
  }
  if (!policy.tiers.length)
    issues.push({ field: "tiers", message: "Cần ít nhất một bậc thưởng." });
  let previous = -1;
  for (const tier of policy.tiers) {
    if (
      !Number.isSafeInteger(tier.minimumScoreBps) ||
      tier.minimumScoreBps < 0 ||
      tier.minimumScoreBps > 10_000 ||
      tier.minimumScoreBps <= previous ||
      !Number.isSafeInteger(tier.payoutBps) ||
      tier.payoutBps < 0 ||
      tier.payoutBps > 100_000
    ) {
      issues.push({
        field: "tiers",
        message: "Bậc thưởng phải tăng dần, không trùng và có tỷ lệ hợp lệ.",
      });
    }
    previous = tier.minimumScoreBps;
  }
  if (policy.allocations) {
    const users = new Set<string>();
    let total = 0;
    for (const allocation of policy.allocations) {
      if (
        !allocation.userId ||
        users.has(allocation.userId) ||
        !Number.isInteger(allocation.shareBps) ||
        allocation.shareBps <= 0 ||
        allocation.shareBps > 10000
      )
        issues.push({
          field: "allocations",
          message: "Phân bổ phải có người phụ trách duy nhất và tỷ lệ hợp lệ.",
        });
      users.add(allocation.userId);
      total += allocation.shareBps;
    }
    if (total !== 10000)
      issues.push({
        field: "allocations",
        message: "Tổng phân bổ quỹ thưởng phải bằng 100%.",
      });
  }
  return issues;
}

export function previewAllocatedRewards(
  policy: RewardPolicy,
  inputs: ReadonlyMap<string, RewardInput>,
) {
  if (validateRewardPolicy(policy).length || !policy.allocations?.length)
    return [];
  return policy.allocations.map((allocation) => {
    const share = BigInt(allocation.shareBps);
    const input = inputs.get(allocation.userId) ?? {
      operationsBps: null,
      businessBps: null,
      fullyVerified: false,
      criticalFailure: false,
    };
    return {
      userId: allocation.userId,
      shareBps: allocation.shareBps,
      result: previewReward(
        {
          ...policy,
          baseCents: Number((BigInt(policy.baseCents) * share) / BigInt(10000)),
          capCents: Number((BigInt(policy.capCents) * share) / BigInt(10000)),
        },
        input,
      ),
    };
  });
}

export interface RewardInput {
  operationsBps: number | null;
  businessBps: number | null;
  fullyVerified: boolean;
  criticalFailure: boolean;
}

export function previewReward(
  policy: RewardPolicy,
  input: RewardInput,
):
  | { state: "unavailable"; reason: string }
  | { state: "calculated"; amountCents: number; scoreBps: number } {
  if (validateRewardPolicy(policy).length)
    return { state: "unavailable", reason: "Chính sách chưa hợp lệ." };
  if (policy.state !== "approved")
    return { state: "unavailable", reason: "Chính sách chưa được duyệt." };
  const { operationsBps: ops, businessBps: business } = input;
  if (
    ops === null ||
    business === null ||
    !Number.isSafeInteger(ops) ||
    !Number.isSafeInteger(business) ||
    ops < 0 ||
    ops > 10_000 ||
    business < 0
  ) {
    return { state: "unavailable", reason: "Chưa đủ dữ liệu KPI hợp lệ." };
  }
  if (policy.requireFullVerification && !input.fullyVerified)
    return {
      state: "unavailable",
      reason: "Kết quả chưa được xác minh đầy đủ.",
    };
  const scoreBps = Number(
    (BigInt(ops) * BigInt(policy.operationsWeightBps) +
      BigInt(Math.min(business, policy.maximumBusinessContributionBps)) *
        BigInt(policy.businessWeightBps) +
      BigInt(5_000)) /
      BigInt(10_000),
  );
  if (
    (policy.blockCriticalFailure && input.criticalFailure) ||
    ops < policy.minimumOperationsBps ||
    business < policy.minimumBusinessBps
  ) {
    return { state: "calculated", amountCents: 0, scoreBps };
  }
  const tier = [...policy.tiers]
    .reverse()
    .find((item) => scoreBps >= item.minimumScoreBps);
  const step = BigInt(policy.roundingCents);
  const numerator = BigInt(policy.baseCents) * BigInt(tier?.payoutBps ?? 0);
  const denominator = BigInt(10_000) * step;
  const rounded = ((numerator + denominator / BigInt(2)) / denominator) * step;
  const capped =
    rounded > BigInt(policy.capCents) ? BigInt(policy.capCents) : rounded;
  return { state: "calculated", amountCents: Number(capped), scoreBps };
}
