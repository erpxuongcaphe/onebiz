"use client";
import { useState } from "react";
import type { Standard } from "@/lib/operations/contracts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import s from "./quality.module.css";

export function StandardLifecycle({ standard, busy, onSave, error }: { standard: Standard; busy: boolean; error?: string; onSave: (action: string, payload: Record<string, unknown>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const discard = standard.status === "draft";
  return <>
    <button type="button" disabled={busy} onClick={() => setOpen(true)}>{discard ? "Xóa bản nháp chưa dùng" : "Ngừng áp dụng"}</button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent className={`${s.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
        <div className={s.dialogHeader}><DialogTitle>{discard ? "Xóa bản nháp" : "Ngừng áp dụng công việc"}</DialogTitle></div>
        {error && <p role="alert" className={s.alert}>{error}</p>}
        <form className={s.dialogForm} onSubmit={async (event) => {
          event.preventDefault(); if (busy) return;
          const form = new FormData(event.currentTarget);
          await onSave(discard ? "discard_standard" : "retire_standard", { id: standard.id, reason: String(form.get("reason") ?? "") });
        }}>
          <div className={s.dialogBody}><strong>{standard.title}</strong><p>{discard ? "Chỉ xóa được bản nháp chưa có lịch, kết quả hoặc QC. Bản nháp thuộc gói Excel phải hủy cả gói trong màn hình nhập." : "Dừng lịch và đợt QC mới cho công việc này tại chi nhánh. Kết quả, lịch đã tạo và điểm kỳ cũ được giữ nguyên. Có thể tạo phiên bản mới để áp dụng lại."}</p><label>Lý do<textarea name="reason" required minLength={5} maxLength={1000}/></label></div>
          <div className={s.dialogFooter}><button type="button" disabled={busy} onClick={() => setOpen(false)}>Chưa thực hiện</button><button disabled={busy} type="submit">{discard ? "Xác nhận xóa bản nháp chưa dùng" : "Xác nhận ngừng áp dụng"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
