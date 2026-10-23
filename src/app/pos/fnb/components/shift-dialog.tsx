"use client";

/**
 * ShiftDialog — Open/Close shift dialogs for F&B POS.
 *
 * - Open: Enter starting cash → opens shift
 * - Close: Shows summary, enter actual cash → reconciles
 *
 * CEO 05/06/2026:
 *  - CloseShift load preview live (cashIn/cashOut/sales by method/orders)
 *  - Hiện chênh lệch real-time khi cashier gõ actualCash
 *  - Confirm popup trước khi đóng (đóng ca không thể hoàn tác)
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { Shift, ShiftCloseKind, ShiftTotalsInput } from "@/lib/types/shift";
import { Icon } from "@/components/ui/icon";
import { previewShiftClose, type ShiftPreview } from "@/lib/services/supabase/shifts";
import { formatPaymentMethod } from "@/lib/constants/payment-methods";
import { ShiftTotalsFields } from "@/components/shared/shift/shift-totals-fields";
import { shiftTotalsDraft, SHIFT_CLOSE_LABELS } from "@/lib/shift-reconciliation";
import { shiftSalesEmptyMessage } from "@/lib/shift-cash-preview";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { BlindCloseShiftDialog } from "@/components/shared/shift/blind-close-shift-dialog";

// R4: Quick-pick denominations cho mở/đóng ca — VND tiền mặt phổ biến.
// Cashier tap pill thay vì gõ số → ít sai sót khi mở ca vội buổi sáng.
const QUICK_DENOMINATIONS = [
  { label: "100k", value: 100_000 },
  { label: "200k", value: 200_000 },
  { label: "500k", value: 500_000 },
  { label: "1M", value: 1_000_000 },
  { label: "2M", value: 2_000_000 },
];

// ── Open Shift Dialog ──

interface OpenShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (startingCash: number) => Promise<void>;
}

export function OpenShiftDialog({ open, onOpenChange, onConfirm }: OpenShiftDialogProps) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(Number(amount) || 0);
    } finally {
      setLoading(false);
      setAmount("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="schedule" className="text-primary" />
            Mở ca làm việc
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <Label>Số dư đầu ca (tiền mặt trong ngăn kéo)</Label>
            <div className="relative mt-1">
              <Icon name="attach_money" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="pl-9 text-lg"
                autoFocus
              />
            </div>
            {/* R4: Quick-pick denominations — tap thay vì gõ số. */}
            <div className="flex flex-wrap gap-2 mt-2">
              {QUICK_DENOMINATIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setAmount(String(d.value))}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                    amount === String(d.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-container-low border-border hover:bg-surface-container hover:border-primary/40",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Nhập số tiền mặt hiện có khi bắt đầu ca. Để trống nếu bắt đầu từ 0.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
            Bắt đầu ca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Close Shift Dialog ──

interface CloseShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentShift: Shift | null;
  onConfirm: (actualCash: number, note?: string, reconciliation?: ShiftTotalsInput) => Promise<void>;
  reconcileTransfer?: boolean;
}

export function CloseShiftDialog(props: CloseShiftDialogProps) {
  const { hasAny, isLoading } = usePermissions();
  if (!props.currentShift || isLoading) return null;
  const canReconcile = hasAny([PERMISSIONS.SHIFTS_RECONCILE_ANY, PERMISSIONS.SHIFTS_RECONCILE_OWN_BRANCH]);
  return canReconcile
    ? <ReconciliationCloseShiftDialog key={props.currentShift.id} {...props} />
    : <BlindCloseShiftDialog key={props.currentShift.id} open={props.open} onOpenChange={props.onOpenChange} onConfirm={props.onConfirm} />;
}

function ReconciliationCloseShiftDialog({
  open,
  onOpenChange,
  currentShift,
  onConfirm,
  reconcileTransfer = false,
}: CloseShiftDialogProps) {
  const [actualCash, setActualCash] = useState("");
  const [actualTransfer,setActualTransfer] = useState("");
  const [closeKind,setCloseKind] = useState<ShiftCloseKind>("end_of_day");
  const [saveError,setSaveError] = useState<string|null>(null);
  const [refreshVersion,setRefreshVersion] = useState(0);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  // CEO 05/06/2026: preview live thông tin ca trước khi đóng
  const [preview, setPreview] = useState<ShiftPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // CEO 05/06/2026: popup xác nhận trước khi đóng (không thể hoàn tác)
  const [showConfirm, setShowConfirm] = useState(false);

  const shiftId = currentShift?.id;
  useEffect(() => {
    if (!open) return;
    setActualCash("");setActualTransfer("");setNote("");setCloseKind("end_of_day");setSaveError(null);setShowConfirm(false);
  }, [open,shiftId]);
  useEffect(() => {
    if (!open || !shiftId) return;
    let cancelled=false;
    setPreview(null);setPreviewLoading(true);setPreviewError(null);setShowConfirm(false);
    previewShiftClose(shiftId).then(value=>{if(!cancelled)setPreview(value);})
      .catch((err:unknown)=>{if(!cancelled)setPreviewError(err instanceof Error?err.message:"Lỗi tải tổng quan");})
      .finally(()=>{if(!cancelled)setPreviewLoading(false);});
    return ()=>{cancelled=true;};
  }, [open,shiftId,refreshVersion]);

  if (!currentShift) return null;

  const elapsed = currentShift.openedAt
    ? Math.round((Date.now() - new Date(currentShift.openedAt).getTime()) / 60_000)
    : 0;
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  const draft=shiftTotalsDraft(preview,actualCash,actualTransfer,closeKind,note);
  const actualCashNum = Number(actualCash) || 0;
  const variance = preview ? actualCashNum - preview.expectedCash : 0;

  const handleConfirm = async () => {
    if(reconcileTransfer&&!draft.valid)return;
    setLoading(true);setSaveError(null);
    try {
      await onConfirm(actualCashNum, note || undefined, reconcileTransfer?draft.input:undefined);
      setShowConfirm(false);
    } catch(error) {
      setSaveError(error instanceof Error?error.message:"Chưa chốt được ca. Kiểm tra và thử lại.");
      setShowConfirm(false);
    } finally { setLoading(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={next=>{if(!loading)onOpenChange(next);}}>
        <DialogContent className={cn("flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden",reconcileTransfer?"sm:max-w-3xl":"sm:max-w-xl")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="check_circle" className="text-status-success" />
              Đóng ca làm việc
            </DialogTitle>
          </DialogHeader>

          <DialogBody>
          {previewLoading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Icon name="progress_activity" className="animate-spin mr-2" />
              Đang tính tổng quan ca...
            </div>
          )}

          {(previewError||saveError)&&<div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>{saveError??previewError}</p><Button type="button" variant="outline" disabled={loading||previewLoading} onClick={()=>{setSaveError(null);setRefreshVersion(v=>v+1);}}>Tải lại tổng quan</Button></div>}
          {preview && (
            <div className="py-2 space-y-4">
              {/* Section: Thời gian + Đơn hàng */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-container-low rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Thời gian ca</div>
                  <div className="text-lg font-bold mt-0.5">{hours}h {mins}p</div>
                </div>
                <div className="bg-surface-container-low rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Số đơn đã bán</div>
                  <div className="text-lg font-bold mt-0.5">{preview.totalOrders}</div>
                </div>
              </div>

              {/* Section: Doanh thu theo phương thức */}
              <div className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                    Doanh thu ròng theo phương thức
                  </span>
                  <span className="font-bold text-status-success tabular-nums">
                    {formatCurrency(preview.totalSales)}đ
                  </span>
                </div>
                {Object.keys(preview.salesByMethod).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">{shiftSalesEmptyMessage(preview)}</p>
                ) : (
                  <div className="space-y-1 pt-1 border-t border-dashed border-border">
                    {Object.entries(preview.salesByMethod).map(([m, amt]) => (
                      <div key={m} className="flex flex-wrap justify-between gap-x-2 text-sm">
                        <span className="text-muted-foreground">
                          • {formatPaymentMethod(m)}
                        </span>
                        <span className="font-medium tabular-nums">{formatCurrency(amt)}đ</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={reconcileTransfer?"grid gap-4 md:grid-cols-2":""}>
              <div className="space-y-4">
              {/* Section: Quỹ tiền mặt */}
              <div className="border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="text-xs font-semibold uppercase text-primary tracking-wide mb-1">
                  Quỹ tiền mặt
                </div>
                <div className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-muted-foreground">Số dư đầu ca</span>
                  <span className="font-medium tabular-nums">{formatCurrency(preview.startingCash)}đ</span>
                </div>
                <div className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-muted-foreground">+ Thu tiền mặt trong ca</span>
                  <span className="font-medium tabular-nums text-status-success">
                    +{formatCurrency(preview.cashIn)}đ
                  </span>
                </div>
                <div className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-muted-foreground">{reconcileTransfer?"− Hoàn/trả và khoản giảm tiền mặt":"− Chi tiền mặt trong ca"}</span>
                  <span className="font-medium tabular-nums text-status-error">
                    −{formatCurrency(preview.cashOut)}đ
                  </span>
                </div>
                <div className="flex flex-wrap justify-between gap-x-2 pt-1.5 border-t border-primary/30">
                  <span className="font-semibold">Tiền mặt dự kiến</span>
                  <span className="font-bold text-base tabular-nums text-primary">
                    {formatCurrency(preview.expectedCash)}đ
                  </span>
                </div>
              </div>

              {/* Actual cash input */}
              <div>
                <Label htmlFor="shift-counted-cash" className="font-semibold">Tiền mặt thực đếm trong ngăn kéo *</Label>
                <div className="relative mt-1">
                  <Icon name="attach_money" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    id="shift-counted-cash" disabled={loading} placeholder="Đếm tiền mặt thực tế và nhập vào đây..."
                    className="pl-9 text-lg h-11"
                    /* autoFocus bỏ — mobile keyboard jump làm mất tóm tắt ca */
                  />
                </div>
                {/* Variance display — show ngay cả khi nhập 0 (két trống thật) */}
                {actualCash !== "" && (
                  <div
                    className={cn(
                      "mt-2 rounded-md px-3 py-2 text-sm font-medium flex items-center gap-2",
                      variance === 0
                        ? "bg-status-success/10 text-status-success"
                        : variance > 0
                          ? "bg-status-warning/10 text-status-warning"
                          : "bg-status-error/10 text-status-error",
                    )}
                  >
                    <Icon
                      size={18}
                      name={
                        variance === 0
                          ? "check_circle"
                          : variance > 0
                            ? "add_circle"
                            : "remove_circle"
                      }
                    />
                    {variance === 0
                      ? "Khớp quỹ — không chênh lệch"
                      : variance > 0
                        ? `Thừa ${formatCurrency(variance)}đ so với dự kiến`
                        : `Thiếu ${formatCurrency(Math.abs(variance))}đ so với dự kiến`}
                  </div>
                )}
              </div>

              </div>
              {reconcileTransfer&&<ShiftTotalsFields id="close-shift" expectedTransfer={draft.expectedTransfer} actualTransfer={actualTransfer} onTransfer={setActualTransfer} closeKind={closeKind} onKind={setCloseKind} disabled={loading}/>}
              </div>
              {reconcileTransfer&&draft.hasDifference&&note.trim().length<3&&<p className="text-sm text-destructive">Nhập lý do chênh lệch trong ghi chú (ít nhất 3 ký tự).</p>}
              {/* Note */}
              <div>
                <Label htmlFor="shift-close-note">{reconcileTransfer&&draft.hasDifference?"Lý do chênh lệch *":"Ghi chú (tùy chọn)"}</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  id="shift-close-note" disabled={loading} placeholder="VD: Thiếu 50k do trả nhầm khách..."
                  className="mt-1"
                />
              </div>
            </div>
          )}

          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Hủy
            </Button>
            <Button
              onClick={() => setShowConfirm(true)}
              // BUG FIX: cho phép nhập 0 (két trống thật) — string "" thay vì
              // !actualCash (đề phòng JS coerce). Cashier có thể đếm ra 0đ.
              disabled={loading || !preview || actualCash === "" || (reconcileTransfer&&!draft.valid)}
              className="bg-status-success text-on-success hover:bg-status-success/90"
            >
              Đóng ca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CEO 05/06/2026: Popup xác nhận trước khi đóng (không thể hoàn tác) */}
      <Dialog open={showConfirm} onOpenChange={(o) => !loading && setShowConfirm(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="warning" className="text-status-warning" />
              Xác nhận đóng ca
            </DialogTitle>
            <DialogDescription>
              Đóng ca KHÔNG THỂ HOÀN TÁC. Số liệu sẽ được chốt vào báo cáo.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-2 text-sm">
            {reconcileTransfer&&<div className="rounded-md border p-2"><b>{SHIFT_CLOSE_LABELS[closeKind]}</b><p>Chuyển khoản thực nhận: {formatCurrency(draft.actualTransfer??0)}đ · theo ca: {formatCurrency(draft.expectedTransfer)}đ</p></div>}
            <div className="flex flex-wrap justify-between gap-x-2">
              <span className="text-muted-foreground">Doanh thu ca:</span>
              <span className="font-bold tabular-nums">{formatCurrency(preview?.totalSales ?? 0)}đ</span>
            </div>
            <div className="flex flex-wrap justify-between gap-x-2">
              <span className="text-muted-foreground">Số đơn:</span>
              <span className="font-bold">{preview?.totalOrders ?? 0}</span>
            </div>
            <div className="flex flex-wrap justify-between gap-x-2">
              <span className="text-muted-foreground">Tiền mặt dự kiến:</span>
              <span className="font-medium tabular-nums">{formatCurrency(preview?.expectedCash ?? 0)}đ</span>
            </div>
            <div className="flex flex-wrap justify-between gap-x-2">
              <span className="text-muted-foreground">Tiền mặt thực tế:</span>
              <span className="font-medium tabular-nums">{formatCurrency(actualCashNum)}đ</span>
            </div>
            {variance !== 0 && (
              <div
                className={cn(
                  "flex justify-between pt-2 border-t",
                  variance > 0 ? "text-status-warning" : "text-status-error",
                )}
              >
                <span className="font-semibold">
                  Chênh lệch:
                </span>
                <span className="font-bold tabular-nums">
                  {variance > 0 ? "+" : ""}
                  {formatCurrency(variance)}đ
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={loading}>
              Xem lại
            </Button>
            <Button onClick={handleConfirm} disabled={loading}>
              {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
              Xác nhận đóng ca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
