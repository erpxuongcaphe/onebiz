"use client";
import { useState, type FormEvent } from "react";
import { formatDate, formatNumber } from "@/lib/format";
import type { Run } from "@/lib/operations/contracts";
import styles from "./workspace.module.css";

export function ResultAdjustmentForm({
  snapshot,
  busy,
  canChangeCriteria,
  onSave,
}: {
  snapshot: unknown;
  busy: boolean;
  canChangeCriteria: boolean;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const runs =
    typeof snapshot === "object" &&
    snapshot !== null &&
    "runs" in snapshot &&
    Array.isArray(snapshot.runs)
      ? (snapshot.runs as Run[])
      : [];
  const [id, setId] = useState("");
  const [criteriaChange, setCriteriaChange] = useState(false);
  const selected = runs.find((run) => run.id === id);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const f = new FormData(event.currentTarget);
    const changes = [
      {
        runId: selected.id,
        observations: selected.criteria.flatMap((c) =>
          Array.from({ length: c.samples }, (_, i) => ({
            criterionId: c.id,
            slot: String(i + 1),
            value:
              c.kind === "percent" ? 0 : Number(f.get(`value:${c.id}:${i}`)),
            evidence: String(f.get(`evidence:${c.id}:${i}`) ?? ""),
            ...(c.kind === "percent"
              ? {
                  numerator: Number(f.get(`numerator:${c.id}:${i}`)),
                  denominator: Number(f.get(`denominator:${c.id}:${i}`)),
                }
              : {}),
          })),
        ),
        ...(criteriaChange
          ? {
              criteria: selected.criteria.map((c) => ({
                ...c,
                threshold: Number(f.get(`threshold:${c.id}`)),
              })),
            }
          : {}),
      },
    ];
    onSave({
      action: "propose_result",
      changes,
      reason: String(f.get("reason")),
      evidence: String(f.get("evidence")),
    });
  }
  return (
    <details>
      <summary>Đề nghị điều chỉnh kết quả vận hành</summary>
      <form onSubmit={submit}>
        <label className={styles.field}>
          Công việc trong bản chốt
          <select
            required
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setCriteriaChange(false);
            }}
          >
            <option value="">Chọn công việc</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.title} · {formatDate(run.original_due_at)}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <div key={selected.id}>
            {canChangeCriteria && (
              <label>
                <input
                  type="checkbox"
                  checked={criteriaChange}
                  onChange={(e) => setCriteriaChange(e.target.checked)}
                />{" "}
                Điều chỉnh ngưỡng tiêu chí bị cấu hình sai
              </label>
            )}
            {selected.criteria.map((c) => (
              <fieldset key={c.id} className={styles.criterion}>
                <legend>{c.title}</legend>
                {criteriaChange ? (
                  <label className={styles.field}>
                    Ngưỡng thay thế
                    <input
                      name={`threshold:${c.id}`}
                      type="number"
                      step="any"
                      required
                      defaultValue={c.threshold}
                    />
                  </label>
                ) : (
                  <p>Ngưỡng đã chốt: {formatNumber(c.threshold)}</p>
                )}
                {Array.from({ length: c.samples }, (_, i) => {
                  const old = selected.observations.find(
                    (o) => o.criterionId === c.id && o.slot === String(i + 1),
                  );
                  return (
                    <div key={i} className={styles.formGrid}>
                      {c.kind === "percent" ? (
                        <>
                          <label className={styles.field}>
                            Lần {i + 1} · Tử số
                            <input
                              name={`numerator:${c.id}:${i}`}
                              type="number"
                              min="0"
                              step="any"
                              required
                              defaultValue={old?.numerator}
                            />
                          </label>
                          <label className={styles.field}>
                            Mẫu số
                            <input
                              name={`denominator:${c.id}:${i}`}
                              type="number"
                              min="0.000001"
                              step="any"
                              required
                              defaultValue={old?.denominator}
                            />
                          </label>
                        </>
                      ) : (
                        <label className={styles.field}>
                          Lần {i + 1} · Kết quả
                          {c.kind === "boolean" ? (
                            <select
                              required
                              name={`value:${c.id}:${i}`}
                              defaultValue={old?.value ?? ""}
                            >
                              <option value="" disabled>
                                Chọn kết quả
                              </option>
                              <option value="1">Có / Đạt</option>
                              <option value="0">Không / Chưa đạt</option>
                            </select>
                          ) : (
                            <input
                              name={`value:${c.id}:${i}`}
                              type="number"
                              step="any"
                              required
                              defaultValue={old?.value}
                            />
                          )}
                        </label>
                      )}
                      <label className={styles.field}>
                        Ghi nhận của lần đo
                        <input
                          name={`evidence:${c.id}:${i}`}
                          required={c.evidenceRequired}
                          maxLength={1000}
                          defaultValue={old?.evidence}
                        />
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
        )}
        <label className={styles.field}>
          Lý do điều chỉnh
          <textarea name="reason" required minLength={5} maxLength={2000} />
        </label>
        <label className={styles.field}>
          Minh chứng đối chiếu
          <textarea name="evidence" required minLength={3} maxLength={2000} />
        </label>
        <button type="submit" disabled={busy || !selected}>
          Gửi đề nghị kết quả
        </button>
      </form>
    </details>
  );
}
