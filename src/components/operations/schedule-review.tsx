"use client";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { formatDate, formatShortDate } from "@/lib/format";
import type { Standard, Run } from "@/lib/operations/contracts";
import type { ScheduleImpact } from "@/lib/operations/schedule-lifecycle";
import { scheduleSummary } from "@/lib/operations/recurrence";
import { ScheduleDateInput, ScheduleTimeInput } from "./schedule-input";
import s from "./quality.module.css";
import css from "./schedule-review.module.css";

export function ScheduleReview({ standard, run, mode, busy, branch, onSaved }: {
  standard?: Standard; run?: Run; mode: "approve" | "end" | "move"; busy: boolean;
  branch: string; onSaved?: () => void;
}) {
  const pending = useRef<{ body: string; requestId: string } | null>(null);
  const lock = useRef(false);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState("");
  const [impact, setImpact] = useState<ScheduleImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function save(action: string, payload: Record<string, unknown>) {
    const body = JSON.stringify({ action, payload: { ...payload, branchId: branch } });
    if (pending.current?.body !== body) pending.current = { body, requestId: crypto.randomUUID() };
    const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(body), requestId: pending.current.requestId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    pending.current = null;
    onSaved?.();
  }
  const title = mode === "end" ? "Kết thúc lặp" : mode === "move" ? "Đổi hạn việc này" : "Duyệt lịch áp dụng";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  async function review() {
    setLoading(true); setError(""); setImpact(null);
    try {
      const from = mode === "end" ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : standard!.effective_from;
      const response = await fetch(`/api/operations/schedule?id=${standard!.id}&from=${from}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setImpact(body); setPolicy(""); setConfirmed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa xem trước được thay đổi."); }
    finally { setLoading(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (busy || loading || lock.current || !confirmed) return;
    lock.current = true; setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "move") {
        await save("move_run", { id: run!.id, version: run!.version, dueAt: `${date}T${form.get("time")}:00+07:00`, reason });
      } else {
        if (!impact || !policy) return;
        await save(mode === "end" ? "end_schedule" : "approve_standard", { id: standard!.id, impactToken: impact.token, futurePolicy: policy, reason, ...(mode === "end" ? { lastDate: date } : {}) });
      }
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa lưu được. Nội dung vẫn được giữ lại."); }
    finally { lock.current = false; setLoading(false); }
  }
  return <>
    <button type="button" disabled={busy} onClick={() => { setOpen(true); setError(""); setImpact(null); setConfirmed(false); setReason(""); setDate(""); }}>
      <Icon name={mode === "approve" ? "check" : mode === "end" ? "event_busy" : "edit_calendar"} size={16}/>{title}
    </button>
    <Dialog open={open} onOpenChange={v => { if (!busy && !loading) setOpen(v); }}>
      <DialogContent className={`${s.dialog} ${css.dialog}`} showCloseButton={false}>
        <div className={`${s.dialogHeader} ${css.header}`}><DialogTitle>{title}</DialogTitle><button type="button" aria-label="Đóng" disabled={busy || loading} onClick={() => setOpen(false)}><Icon name="close" size={18}/></button></div>
        <form className={s.dialogForm} onSubmit={submit}>
          <div className={s.dialogBody}>
            <h3>{standard?.title ?? run?.title}</h3>
            {error && <p role="alert" className={s.alert}>{error}</p>}
            {mode !== "move" && <p>{scheduleSummary(standard!.frequency, standard!.day_number, standard!.month_number ?? 1)} · {standard!.due_time.slice(0,5)}</p>}
            {mode === "approve" && <p>Dùng lịch mới từ {formatShortDate(`${standard!.effective_from}T00:00:00+07:00`)}. Kết quả cũ và điểm kỳ trước không bị viết lại.</p>}
            {mode === "end" && <label>Ngày thực hiện cuối cùng<ScheduleDateInput aria-label="Ngày thực hiện cuối cùng" name="lastDate" required min={today} value={date} onValueChange={v => { setDate(v); setImpact(null); setConfirmed(false); }}/><small>Sau ngày này không tạo việc mới. To-do đang mở vẫn phải được xử lý.</small></label>}
            {mode === "move" && <><p>Hạn đang áp dụng: {formatDate(run!.current_due_at ?? run!.original_due_at)}</p><p>Chỉ đổi việc này, không đổi lịch lặp. Hạn gốc {formatDate(run!.original_due_at)} vẫn được giữ để đánh giá đúng hạn/trễ.</p><div className={css.fields}><label>Ngày hạn mới<ScheduleDateInput name="date" required min={today} value={date} onValueChange={setDate}/></label><label>Giờ hạn mới<ScheduleTimeInput name="time" required defaultValue="17:00"/></label></div></>}
            {mode !== "move" && <button type="button" disabled={busy || loading || (mode === "end" && !date)} onClick={() => void review()}>{loading ? "Đang kiểm tra…" : "Xem việc bị ảnh hưởng"}</button>}
            {impact && <section className={css.impact} aria-label="Thay đổi sẽ áp dụng"><h3>Thay đổi sẽ áp dụng</h3>
              {mode === "approve" && impact.previousSchedule && <div className={css.fields}><div><strong>Lịch đang áp dụng</strong><p>{scheduleSummary(impact.previousSchedule.frequency,impact.previousSchedule.day_number,impact.previousSchedule.month_number ?? 1)} · {impact.previousSchedule.due_time.slice(0,5)}</p></div><div><strong>Lịch sau thay đổi</strong><p>{scheduleSummary(standard!.frequency,standard!.day_number,standard!.month_number ?? 1)} · {standard!.due_time.slice(0,5)}</p></div></div>}
              <p>{impact.replaceable.length} việc chưa thực hiện · {impact.protected.length} việc được giữ nguyên vì đã có kết quả, hồ sơ, quá hạn hoặc kỳ đã chốt.</p>
              {impact.replaceable.length > 0 ? <fieldset><legend>Việc chưa thực hiện sẽ xử lý thế nào?</legend><label><input type="radio" name="futurePolicy" value="replace_empty" checked={policy === "replace_empty"} onChange={() => setPolicy("replace_empty")}/>{mode === "end" ? "Hủy các việc sau ngày kết thúc" : "Thay bằng lịch mới"}</label><label><input type="radio" name="futurePolicy" value="keep" checked={policy === "keep"} onChange={() => setPolicy("keep")}/>Giữ các việc đã tạo và hạn hiện tại</label></fieldset> : <label><input type="checkbox" checked={policy === "keep"} onChange={e => setPolicy(e.target.checked ? "keep" : "")}/>Giữ nguyên các hồ sơ đã có</label>}
              <details><summary>Xem danh sách {impact.count} việc</summary><ul>{[...impact.replaceable, ...impact.protected].map(item => <li key={item.id}>{item.title} · {formatDate(item.due)} · {impact.protected.some(p => p.id === item.id) ? "Giữ nguyên" : "Chưa thực hiện"}</li>)}</ul></details>
              <p>Hủy do thay đổi lịch không được tính là hoàn thành. Các hồ sơ đã có kết quả vẫn giữ trong thống kê; To-do và điểm QC không tự thay đổi.</p>
            </section>}
            <label>Lý do<textarea name="reason" required minLength={5} maxLength={1000} rows={2} value={reason} onChange={e => setReason(e.target.value)}/></label>
            <label className={css.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Tôi đã kiểm tra phạm vi thay đổi</label>
          </div>
          <div className={s.dialogFooter}><button type="button" disabled={busy || loading} onClick={() => setOpen(false)}>Quay lại</button><button className={s.primary} type="submit" disabled={busy || loading || !confirmed || reason.trim().length < 5 || (mode !== "move" && (!impact || !policy))}>{busy || loading ? "Đang xử lý…" : "Xác nhận lưu"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
