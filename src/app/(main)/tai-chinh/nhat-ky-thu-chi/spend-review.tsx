"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { formatCashBookDate, formatCashTime } from "@/lib/cash-time";
import type { JournalOption } from "@/lib/services/supabase/cash-journal";
import {
  decideSpendReview, downloadSpendEvidence, readSpendQueue, readSpendReview, submitSpendReview,
  type SpendDecision, type SpendQueueItem, type SpendReviewDetail,
} from "@/lib/services/supabase/cash-spend-review";
import styles from "./journal.module.css";

const labels = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối", withdrawn: "Đã rút" };

export function SpendQueue({ close, select }: { close: () => void; select: (id: string) => void }) {
  const [items, setItems] = useState<SpendQueueItem[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void readSpendQueue(c.signal).then(result => { if (!c.signal.aborted) setItems(result.queue); },
      err => { if (!c.signal.aborted) setError(err.message); });
    return () => c.abort();
  }, [attempt]);

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className={styles.dialog}>
      <DialogTitle>Chờ tôi duyệt</DialogTitle>
      <DialogDescription>Hồ sơ xác nhận đơn vị thực chi · ĐVT: đồng</DialogDescription>
      {error ? <div role="alert">{error} <Button size="sm" onClick={() => { setError(""); setAttempt(v => v + 1); }}>Thử lại</Button></div>
        : !items ? <p role="status">Đang tải...</p>
        : !items.length ? <p>Không có hồ sơ chờ duyệt.</p>
        : <ul className={styles.queue}>{items.slice(0, 50).map(row => <li key={row.id}>
          <button type="button" onClick={() => select(row.cash_id)}>
            <span><strong>{row.code}</strong><small>{row.branch_name} · {formatCashBookDate(row.transaction_date)}</small></span>
            <strong>{formatNumber(row.amount)}</strong>
          </button>
        </li>)}</ul>}
      {items && items.length > 50 && <p className={styles.muted}>Hiển thị 50 hồ sơ chờ lâu nhất.</p>}
    </DialogContent>
  </Dialog>;
}

export function SpendReview({ cashId, branches, canSubmit, canApprove, close, onChange }: {
  cashId: string; branches: JournalOption[]; canSubmit: boolean; canApprove: boolean;
  close: () => void; onChange: () => void;
}) {
  const [result, setResult] = useState<SpendReviewDetail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const pending = result?.history.find(row => row.status === "pending");
  const active = result?.history.find(row => row.status === "approved" && row.effective);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void readSpendReview(cashId, c.signal).then(data => { if (!c.signal.aborted) setResult(data); },
      err => { if (!c.signal.aborted) setError(err.message); });
    return () => c.abort();
  }, [cashId, revision]);
  useEffect(() => () => operation.current?.abort(), []);

  async function run(fn: (signal: AbortSignal) => Promise<unknown>, write = true) {
    if (busy || operation.current) return;
    const c = new AbortController();
    operation.current = c;
    setBusy(true);
    setError("");
    try {
      await fn(c.signal);
      if (write && !c.signal.aborted) {
        setResult(undefined); setRevision(v => v + 1); setNote(""); setChecked(false);
        onChange();
      }
    } catch (err) {
      if (!c.signal.aborted) setError(err instanceof Error ? err.message : "Không thực hiện được thao tác.");
    } finally {
      if (!c.signal.aborted) { operation.current = null; setBusy(false); }
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const file = values.get("file");
    if (!(file instanceof File) || !file.size) { setError("Cần đính kèm chứng từ đối chiếu."); return; }
    void run(signal => submitSpendReview(cashId, String(values.get("payer")), String(values.get("reviewer")), String(values.get("ref")), file, signal));
  }
  function decide(status: SpendDecision) {
    if (!pending) return;
    if (status !== "approved" && note.trim().length < 3) { setError("Ghi rõ lý do xử lý hồ sơ."); return; }
    if (status === "approved" && !checked) return;
    void run(signal => decideSpendReview(pending.id, status, note.trim(), checked, signal));
  }
  const actionable = pending && ((canApprove && pending.assigned) || (canSubmit && pending.mine)) ? pending : undefined;
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className={styles.dialog}>
      <DialogTitle>Đơn vị thực chi{result ? ` · ${result.voucher.code}` : ""}</DialogTitle>
      <DialogDescription>{result ? `Chi nhánh liên quan: ${result.voucher.branch} · ${formatNumber(result.voucher.amount)} đồng` : "Xác nhận trên phiếu chi gốc"}</DialogDescription>
      {error && <p role="alert" className={styles.error}>{error} {!result && <Button size="sm" onClick={() => { setError(""); setRevision(v => v + 1); }}>Thử lại</Button>}</p>}
      {!result && !error && <p role="status">Đang tải hồ sơ...</p>}
      {result && <>
        {pending && !pending.current && <p className={styles.error}>Phiếu gốc đã thay đổi. Hồ sơ này không thể duyệt.</p>}
        {actionable && <div className={styles.filterForm}>
          <strong>Đơn vị đề xuất: {actionable.payer}</strong>
          {actionable.evidence_ref && <span>{actionable.evidence_ref}</span>}
          {actionable.file_name && <button type="button" className={styles.link} disabled={busy}
            onClick={() => void run(signal => downloadSpendEvidence(actionable.id, signal), false)}>Tải chứng từ: {actionable.file_name}</button>}
          {canApprove && actionable.assigned && actionable.current && <label className={styles.reviewCheck}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />Đã đối chiếu chứng từ
          </label>}
          <label>Ý kiến xử lý<textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <div className={styles.actions}>
            {canSubmit && actionable.mine && <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("withdrawn")}>Rút hồ sơ</Button>}
            {canApprove && actionable.assigned && <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("rejected")}>Từ chối</Button>
              <Button size="sm" disabled={busy || !actionable.current || !checked} onClick={() => decide("approved")}>Duyệt đơn vị thực chi</Button>
            </>}
          </div>
        </div>}
        {canSubmit && !pending && result.voucher.completed && (
          result.reviewers.length ? <details open={active ? undefined : true} className={styles.reviewForm}>
            <summary>{active ? "Gửi xác nhận thay thế" : "Gửi xác nhận"}</summary>
            {active && <p className={styles.muted}>Khi gửi lại, xác nhận cũ tạm ẩn khỏi phạm vi xem của quản lý.</p>}
            <form className={styles.filterForm} onSubmit={submit}>
              <div className={styles.reviewFields}>
                <label>Đơn vị thực chi<select name="payer" required defaultValue="">
                  <option value="" disabled>Chọn đơn vị</option><option value="company">Công ty</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select></label>
                <label>Người duyệt<select name="reviewer" required defaultValue="">
                  <option value="" disabled>Chọn người duyệt</option>
                  {result.reviewers.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select></label>
              </div>
              <label>Mã hoặc nội dung đối chiếu<input name="ref" required minLength={3} maxLength={250} /></label>
              <label>Chứng từ đối chiếu<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required /><span className={styles.muted}>PDF, JPG hoặc PNG · tối đa 2 MB</span></label>
              <div className={styles.actions}><Button size="sm" type="submit" disabled={busy}>Gửi duyệt</Button></div>
            </form>
          </details> : <p>Chưa có người đủ quyền duyệt khác người gửi.</p>
        )}
        <ul className={styles.reviewHistory} aria-label="Lịch sử duyệt">
          {result.history.map(row => <li key={row.id}>
            <strong>{row.payer} · {labels[row.status]}</strong>
            <span>{row.submitter} → {row.reviewer} · {formatNumber(row.reviewed_amount)} đồng</span>
            <small>{formatCashTime(row.submitted_at)}{row.decided_at && ` · Xử lý: ${formatCashTime(row.decided_at)}`}</small>
            {row.status === "approved" && !row.effective && <small>Không còn hiệu lực với phiếu hiện tại</small>}
            {row.evidence_ref && row.id !== actionable?.id && <span>{row.evidence_ref}</span>}
            {row.decision_note && <span>{row.decision_note}</span>}
            {row.file_name && row.id !== actionable?.id && <button type="button" className={styles.link} disabled={busy}
              onClick={() => void run(signal => downloadSpendEvidence(row.id, signal), false)}>Tải chứng từ: {row.file_name}</button>}
          </li>)}
        </ul>
      </>}
    </DialogContent>
  </Dialog>;
}
