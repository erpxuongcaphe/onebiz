"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";

interface BlindCloseShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (actualCash: number, note?: string) => Promise<void>;
}

export function BlindCloseShiftDialog({ open, onOpenChange, onConfirm }: BlindCloseShiftDialogProps) {
  const [actualCash, setActualCash] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const valid = actualCash !== null && Number.isSafeInteger(actualCash) && actualCash >= 0;

  async function submit() {
    if (!valid || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setFailed(false);
    try {
      await onConfirm(actualCash!, note.trim() || undefined);
      setActualCash(null);
      setNote("");
      setConfirming(false);
    } catch {
      setFailed(true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function changeOpen(next: boolean) {
    if (submitting.current) return;
    if (!next) {
      setConfirming(false);
      setFailed(false);
      setActualCash(null);
      setNote("");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md [&_[data-slot=dialog-close]]:size-11">
        <DialogHeader className="pr-10">
          <DialogTitle>{confirming ? "Xác nhận đóng ca" : "Đóng ca làm việc"}</DialogTitle>
          <DialogDescription>
            {confirming ? "Số tiền kiểm đếm sẽ được lưu để đối chiếu." : "Ghi nhận tiền mặt thực đếm cuối ca."}
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <div className="space-y-3 border-y py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground">Tiền mặt thực đếm</span>
              <strong className="text-xl tabular-nums">{formatCurrency(actualCash ?? 0)} đ</strong>
            </div>
            {note.trim() && <p className="break-words text-sm text-muted-foreground">{note.trim()}</p>}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="blind-close-actual-cash">Tiền mặt thực đếm (đ)</Label>
              <NumericInput id="blind-close-actual-cash" value={actualCash} onChange={setActualCash}
                min={0} max={Number.MAX_SAFE_INTEGER} decimals={0} disabled={loading}
                placeholder="Nhập số tiền" className="h-11 text-lg tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="blind-close-note">Ghi chú</Label>
              <Input id="blind-close-note" value={note} onChange={(event) => setNote(event.target.value)}
                maxLength={1000} disabled={loading} />
            </div>
          </div>
        )}
        {failed && <p role="alert" className="text-sm text-destructive">Chưa xác nhận được kết quả. Kiểm tra lại trạng thái ca.</p>}
        <DialogFooter>
          <Button className="h-11 min-h-11" variant="outline" disabled={loading} onClick={() => confirming ? setConfirming(false) : changeOpen(false)}>
            {confirming ? "Xem lại" : "Đóng"}
          </Button>
          <Button className="h-11 min-h-11" disabled={!valid || loading} onClick={() => confirming ? void submit() : setConfirming(true)}>
            {loading ? "Đang chốt ca..." : confirming ? "Xác nhận đóng ca" : "Tiếp tục"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
