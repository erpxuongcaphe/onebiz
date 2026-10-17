"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { Criterion, Person } from "@/lib/operations/contracts";
import {
  rewardPolicyFromForm,
  type Frequency,
} from "@/lib/operations/configuration";
import {
  previewAllocatedRewards,
  type RewardPolicy,
} from "@/lib/operations/policy";
import { formatNumber } from "@/lib/format";
import { frequencyLabels } from "@/lib/operations/recurrence";
import styles from "./workspace.module.css";

export function ConfigurationReview({
  kind,
  form,
  criteria,
  frequency,
  managers,
  tiers,
  version,
  issues,
}: {
  kind: "standard" | "policy";
  form: FormData | null;
  criteria: Criterion[];
  frequency: Frequency;
  managers: Person[];
  tiers: RewardPolicy["tiers"];
  version: string;
  issues: string[];
}) {
  const [ops, setOps] = useState("90");
  const [business, setBusiness] = useState("100");
  const [verified, setVerified] = useState(true);
  const [critical, setCritical] = useState(false);
  let policy: RewardPolicy | null = null;
  if (kind === "policy" && form) {
    try {
      policy = rewardPolicyFromForm(form, managers, tiers, version);
    } catch {
      /* Validation is shown below. */
    }
  }
  const validScenario =
    /^\d+(\.\d{1,2})?$/.test(ops) &&
    /^\d+(\.\d{1,2})?$/.test(business) &&
    Number(ops) <= 100 &&
    Number(business) <= 1000;
  const rewards =
    policy && validScenario
      ? previewAllocatedRewards(
          { ...policy, state: "approved" },
          new Map(
            managers.map((person) => [
              person.id,
              {
                operationsBps: Math.round(Number(ops) * 100),
                businessBps: Math.round(Number(business) * 100),
                fullyVerified: verified,
                criticalFailure: critical,
              },
            ]),
          ),
        )
      : [];
  return (
    <aside
      className={styles.configurationReview}
      aria-label="Kiểm tra cấu hình"
    >
      <h3>
        <Icon name="fact_check" size={18} />
        Kiểm tra trước khi lưu
      </h3>
      <dl className={styles.reviewValues}>
        <div>
          <dt>Trạng thái</dt>
          <dd>Bản nháp</dd>
        </div>
        {kind === "standard" ? (
          <>
            <div>
              <dt>Tần suất</dt>
              <dd>
                {frequencyLabels[frequency]}
              </dd>
            </div>
            <div>
              <dt>Tiêu chí</dt>
              <dd>{formatNumber(criteria.length)}</dd>
            </div>
            <div>
              <dt>Lần kiểm tra / công việc</dt>
              <dd>
                {formatNumber(
                  criteria.reduce(
                    (sum, criterion) => sum + criterion.samples,
                    0,
                  ),
                )}
              </dd>
            </div>
            <div>
              <dt>Lỗi nghiêm trọng</dt>
              <dd>
                {formatNumber(
                  criteria.filter((criterion) => criterion.critical).length,
                )}
              </dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Tổng trọng số</dt>
              <dd>{policy ? "100%" : "Chưa hợp lệ"}</dd>
            </div>
            <div>
              <dt>Tổng phân bổ</dt>
              <dd>{policy ? "100%" : "Chưa hợp lệ"}</dd>
            </div>
            <div>
              <dt>Quỹ thưởng (VND)</dt>
              <dd>{policy ? formatNumber(policy.baseCents / 100) : "—"}</dd>
            </div>
          </>
        )}
      </dl>
      {!!issues.length && (
        <ul
          className={styles.configurationIssues}
          aria-label="Thông tin cần kiểm tra"
        >
          {issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
      {kind === "policy" && (
        <section className={styles.simulation} aria-label="Mô phỏng thưởng">
          <h3>
            <Icon name="calculate" size={18} />
            Mô phỏng thưởng
          </h3>
          <label className={styles.field}>
            <span>Vận hành giả định (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={ops}
              onChange={(event) => setOps(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Kinh doanh giả định (%)</span>
            <input
              type="number"
              min={0}
              max={1000}
              step="0.01"
              value={business}
              onChange={(event) => setBusiness(event.target.value)}
            />
          </label>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={verified}
              onChange={(event) => setVerified(event.target.checked)}
            />
            Đã xác minh đủ
          </label>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={critical}
              onChange={(event) => setCritical(event.target.checked)}
            />
            Có lỗi nghiêm trọng
          </label>
          {!validScenario && (
            <p role="alert" className={styles.error}>
              Tỷ lệ mô phỏng chưa hợp lệ.
            </p>
          )}
          <dl className={styles.reviewValues}>
            {rewards.map((reward) => (
              <div key={reward.userId}>
                <dt>
                  {managers.find((person) => person.id === reward.userId)
                    ?.name ?? "Người nhận"}
                </dt>
                <dd>
                  {reward.result.state === "calculated"
                    ? `${formatNumber(reward.result.amountCents / 100)} VND`
                    : reward.result.reason}
                </dd>
              </div>
            ))}
          </dl>
          <small>Số mô phỏng, không ghi nhận chi trả.</small>
        </section>
      )}
    </aside>
  );
}
