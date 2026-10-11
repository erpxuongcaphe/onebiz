"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from "react";
import { formatNumber, formatDate } from "@/lib/format";
import { parseMoneyUS } from "@/lib/operations/policy";
import { readClosedPeriod } from "@/lib/operations/closed-period";
import styles from "./workspace.module.css";
import { ResultAdjustmentForm } from "./result-adjustment-form";
export interface AdjustedPeriod {
  periodId: string;
  snapshot: unknown;
  revision: number;
}
interface Adjustment {
  run_changes?: unknown[];
  id: string;
  state: string;
  base_revision: number;
  created_by: string;
  created_at: string;
  revenue_cents: number;
  target_cents: number;
  reason: string;
  evidence: string;
  snapshot: unknown;
}
export function PeriodAdjustments({
  periodId,
  original,
  canPropose,
  canApprove,
  isCeo,
  userId,
  onChange,
}: {
  periodId: string;
  original: unknown;
  canPropose: boolean;
  canApprove: boolean;
  isCeo: boolean;
  userId: string;
  onChange: Dispatch<SetStateAction<AdjustedPeriod | null>>;
}) {
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const pending = useRef<{ body: string; requestId: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  async function load() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError("");
    try {
      const response = await fetch(
        `/api/operations/adjustments?periodId=${periodId}`,
        { cache: "no-store", signal: controller.signal },
      );
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error);
      const list = body.result as Adjustment[];
      setRows(list);
      const latest = list
        .filter((a) => a.state === "approved")
        .sort((a, b) => b.base_revision - a.base_revision)[0];
      onChange(
        latest
          ? {
              periodId,
              snapshot: latest.snapshot,
              revision: latest.base_revision + 1,
            }
          : { periodId, snapshot: original, revision: 0 },
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Không tải được điều chỉnh.",
        );
    }
  }
  useEffect(() => {
    setRows([]);
    onChange({ periodId, snapshot: null, revision: 0 });
    pending.current = null;
    void load();
    return () => active.current?.abort();
    // Reads are triggered only by the selected period or a successful command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);
  const approved = rows
    .filter((a) => a.state === "approved")
    .sort((a, b) => b.base_revision - a.base_revision)[0];
  const revision = approved ? approved.base_revision + 1 : 0;
  const source = readClosedPeriod(approved?.snapshot ?? original);
  async function save(command: Record<string, unknown>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify(command);
      if (command.action === "propose" || command.action === "propose_result") {
        if (pending.current?.body !== body)
          pending.current = { body, requestId: crypto.randomUUID() };
        command = { ...command, requestId: pending.current.requestId };
      }
      const response = await fetch("/api/operations/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      pending.current = null;
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không lưu được điều chỉnh.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const revenue = parseMoneyUS(String(f.get("revenue")));
    const target = parseMoneyUS(String(f.get("target")));
    if (revenue === null || target === null || target <= 0) {
      setError("Số tiền theo dạng 1,234.56; chỉ tiêu phải lớn hơn 0.");
      return;
    }
    void save({
      action: "propose",
      periodId,
      baseRevision: revision,
      revenueCents: revenue,
      targetCents: target,
      reason: String(f.get("reason")),
      evidence: String(f.get("evidence")),
    });
  }
  return (
    <section>
      <h2 className={styles.sectionTitle}>Điều chỉnh số liệu kỳ đã chốt</h2>
      {error && (
        <p role="alert">
          {error}{" "}
          <button disabled={busy} onClick={() => void load()}>
            Tải lại
          </button>
        </p>
      )}
      {canPropose && source && (
        <ResultAdjustmentForm
          snapshot={approved?.snapshot ?? original}
          busy={busy}
          canChangeCriteria={canApprove}
          onSave={(values) =>
            void save({ ...values, periodId, baseRevision: revision })
          }
        />
      )}
      {canPropose && source && (
        <details>
          <summary>Đề nghị điều chỉnh doanh thu hoặc chỉ tiêu</summary>
          <form key={revision} onSubmit={propose}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                Doanh thu mới
                <input
                  name="revenue"
                  required
                  defaultValue={formatNumber(source.revenue.amount_cents / 100)}
                />
              </label>
              <label className={styles.field}>
                Chỉ tiêu mới
                <input
                  name="target"
                  required
                  defaultValue={formatNumber(source.target.amount_cents / 100)}
                />
              </label>
            </div>
            <label className={styles.field}>
              Lý do điều chỉnh
              <textarea name="reason" required minLength={5} maxLength={2000} />
            </label>
            <label className={styles.field}>
              Minh chứng đối chiếu
              <textarea
                name="evidence"
                required
                minLength={3}
                maxLength={2000}
              />
            </label>
            <button disabled={busy} type="submit">
              Gửi đề nghị
            </button>
          </form>
        </details>
      )}
      {rows.map((a) => (
        <article key={a.id} className={styles.audit}>
          <strong>
            {a.state === "approved"
              ? `Phiên bản ${a.base_revision + 1} đã duyệt`
              : "Đề nghị chờ duyệt"}
          </strong>
          <p>
            {formatDate(a.created_at)} · Doanh thu{" "}
            {formatNumber(a.revenue_cents / 100)} · Chỉ tiêu{" "}
            {formatNumber(a.target_cents / 100)}
          </p>
          <p>{a.reason}</p>
          {!!a.run_changes?.length && (
            <p>
              Điều chỉnh kết quả vận hành · {formatNumber(a.run_changes.length)}{" "}
              công việc
            </p>
          )}
          <p>{a.evidence}</p>
          {a.state === "pending" &&
            canApprove &&
            (a.created_by !== userId || isCeo) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({
                    action: "approve",
                    id: a.id,
                    note: String(new FormData(e.currentTarget).get("note")),
                  });
                }}
              >
                <label className={styles.field}>
                  Nhận xét phê duyệt
                  <textarea
                    name="note"
                    required
                    minLength={5}
                    maxLength={2000}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || a.base_revision !== revision}
                >
                  Duyệt phiên bản điều chỉnh
                </button>
              </form>
            )}
        </article>
      ))}
    </section>
  );
}
