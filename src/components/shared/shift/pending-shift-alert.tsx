"use client";

/**
 * PendingShiftAlert — Hook + Dialog shared cho POS Retail + POS FnB.
 *
 * CEO 05/06/2026 (migration 00127):
 *   Khi POS mount → tự gọi RPC mark_overdue_shifts_for_branch để chuyển
 *   ca quên đóng thành pending_reconcile. Sau đó query danh sách
 *   pending_shifts_view và hiển thị popup cảnh báo.
 *
 * UX:
 *   - Popup hiện giữa màn hình khi có >= 1 ca pending
 *   - 2 lựa chọn: "Đối chiếu ngay" (mở sub-dialog) hoặc "Để sau"
 *   - "Để sau" → đóng popup, KHÔNG chặn bán hàng (tránh mất doanh thu)
 *   - Sub-dialog reconcile: bắt buộc nhập tiền mặt thực tế + lý do
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useAuth, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import {
  getPendingShifts,
  markOverdueShiftsForBranch,
  previewShiftClose,
  reconcilePendingShift,
  type PendingShift,
  type ShiftPreview,
} from "@/lib/services/supabase/shifts";
import { formatPaymentMethod } from "@/lib/constants/payment-methods";

// ─── Wrapper: Section to mount in POS (Retail + FnB) ────────

/**
 * Mount 1 lần trong POS page. Tự load pending shifts + show popup.
 * Cashier "Để sau" → đóng popup, KHÔNG chặn bán hàng.
 * Sau khi reconcile xong → tự refresh list.
 */
export function PendingShiftAlertSection({
  branchId,
}: {
  branchId: string | null;
}) {
  const { hasPermission } = usePermissions();
  // Chỉ user có quyền reconcile mới load + thấy popup
  // (cashier KHÔNG được reconcile ca của chính mình — xung đột lợi ích)
  const canReconcile =
    hasPermission("shifts.reconcile_any") ||
    hasPermission("shifts.reconcile_own_branch");

  const { pendings, refresh } = usePendingShiftAlert(
    canReconcile ? branchId : null,
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = pendings.filter((s) => !dismissed.has(s.id));

  if (!canReconcile || visible.length === 0) return null;

  return (
    <PendingShiftAlertDialog
      pendings={visible}
      onClose={() => {
        // "Để sau" — dismiss session, ca vẫn còn pending trong DB
        setDismissed(new Set(visible.map((s) => s.id)));
      }}
      onReconciled={() => {
        // Reconcile xong → refresh list để loại bỏ ca đã reconcile
        void refresh();
      }}
    />
  );
}

// ─── Hook ────────────────────────────────────────────────────

export function usePendingShiftAlert(branchId: string | null | undefined) {
  const [pendings, setPendings] = useState<PendingShift[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      await markOverdueShiftsForBranch(branchId).catch((err) => {
        console.warn("[usePendingShiftAlert] mark_overdue lỗi:", err);
      });
      const rows = await getPendingShifts(branchId);
      setPendings(rows);
    } catch (err) {
      console.error("[usePendingShiftAlert] load lỗi:", err);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pendings, loading, refresh };
}

// ─── Dialog — Cảnh báo + danh sách pending ──────────────────

interface PendingShiftAlertDialogProps {
  pendings: PendingShift[];
  onClose: () => void;
  onReconciled: () => void;
}

export function PendingShiftAlertDialog({
  pendings,
  onClose,
  onReconciled,
}: PendingShiftAlertDialogProps) {
  const [selected, setSelected] = useState<PendingShift | null>(null);

  if (pendings.length === 0) return null;

  return (
    <>
      <Dialog open={!selected} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="warning" className="text-status-warning" />
              {pendings.length === 1
                ? "1 ca chưa đối chiếu"
                : `${pendings.length} ca chưa đối chiếu`}
            </DialogTitle>
            <DialogDescription>
              Có ca mở quá lâu mà chưa được đóng. Cần đối chiếu để chốt số liệu
              vào báo cáo.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-2 max-h-[50vh] overflow-y-auto">
            {pendings.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s)}
                className="w-full text-left rounded-lg border bg-card p-3 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{s.cashierName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {s.branchName} · Mở lúc{" "}
                      {new Date(s.openedAt).toLocaleString("vi-VN")}
                    </p>
                    <p className="text-xs text-status-warning mt-1">
                      ⏱ Kéo dài {Math.round(s.shiftDurationHours)}h
                      {s.startingCash > 0 && (
                        <> · Đầu ca {formatCurrency(s.startingCash)}đ</>
                      )}
                    </p>
                  </div>
                  <Icon
                    name="chevron_right"
                    size={18}
                    className="text-muted-foreground shrink-0"
                  />
                </div>
              </button>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>
              Để sau
            </Button>
            {pendings.length === 1 && (
              <Button onClick={() => setSelected(pendings[0])}>
                Đối chiếu ngay
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selected && (
        <ReconcileShiftDialog
          shift={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            onReconciled();
          }}
        />
      )}
    </>
  );
}

// ─── Sub-dialog: Reconcile 1 ca pending ─────────────────────

function ReconcileShiftDialog({
  shift,
  onClose,
  onDone,
}: {
  shift: PendingShift;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  // CEO 05/06/2026 chốt: quản lý chi nhánh chịu trách nhiệm chi nhánh
  // của mình. KHÔNG block self-reconcile. Owner đối chiếu thu/doanh số
  // qua báo cáo + audit log (reconciled_by, reason ghi đầy đủ).
  // Chỉ hiện soft notice để user ý thức "đây là tự đối chiếu".
  const isSelfReconcile = user?.id === shift.cashierId;

  const [preview, setPreview] = useState<ShiftPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actualCash, setActualCash] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    previewShiftClose(shift.id)
      .then(setPreview)
      .catch((err: unknown) => {
        setPreviewError(err instanceof Error ? err.message : "Lỗi tải tổng quan");
      });
  }, [shift.id]);

  const actualCashNum = Number(actualCash) || 0;
  const variance = preview ? actualCashNum - preview.expectedCash : 0;
  const reasonValid = reason.trim().length >= 3;

  const handleConfirm = async () => {
    if (!reasonValid) return;
    setLoading(true);
    try {
      await reconcilePendingShift({
        shiftId: shift.id,
        actualCash: actualCashNum,
        reason: reason.trim(),
        note: note.trim() || undefined,
      });
      toast({
        title: "Đã đối chiếu ca",
        description: `Ca của ${shift.cashierName} chốt với ${formatCurrency(actualCashNum)}đ tiền mặt thực tế.`,
        variant: "success",
      });
      onDone();
    } catch (err) {
      toast({
        title: "Đối chiếu thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !loading && onClose()}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="fact_check" className="text-primary" />
              Đối chiếu ca — {shift.cashierName}
            </DialogTitle>
            <DialogDescription>
              {shift.branchName} · Mở lúc{" "}
              {new Date(shift.openedAt).toLocaleString("vi-VN")}
            </DialogDescription>
          </DialogHeader>

          {!preview && !previewError && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Icon name="progress_activity" className="animate-spin mr-2" />
              Đang tính tổng quan ca...
            </div>
          )}

          {previewError && (
            <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-xs text-status-error">
              Không tải được tổng quan: {previewError}
            </div>
          )}

          {preview && isSelfReconcile && (
            <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <Icon name="info" size={18} className="text-status-warning mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-status-warning">
                    Tự đối chiếu — sẽ được ghi vào nhật ký
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Đây là ca do anh/chị mở. Hệ thống ghi nhận anh/chị tự
                    đếm tiền và chốt ca, kèm lý do dưới đây. Chủ shop sẽ
                    đối chiếu lại qua báo cáo doanh số.
                  </p>
                </div>
              </div>
            </div>
          )}

          {preview && (
            <div className="py-2 space-y-4">
              {/* Doanh thu theo phương thức */}
              <div className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                    Doanh thu theo phương thức
                  </span>
                  <span className="font-bold text-status-success tabular-nums">
                    {formatCurrency(preview.totalSales)}đ
                  </span>
                </div>
                {Object.keys(preview.salesByMethod).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Chưa có giao dịch trong ca
                  </p>
                ) : (
                  <div className="space-y-1 pt-1 border-t border-dashed">
                    {Object.entries(preview.salesByMethod).map(([m, amt]) => (
                      <div key={m} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          • {formatPaymentMethod(m)}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(amt)}đ
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {preview.totalOrders} đơn hoàn thành
                </div>
              </div>

              {/* Quỹ tiền mặt */}
              <div className="border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="text-xs font-semibold uppercase text-primary tracking-wide mb-1">
                  Quỹ tiền mặt
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Số dư đầu ca</span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(preview.startingCash)}đ
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">+ Thu tiền mặt</span>
                  <span className="font-medium tabular-nums text-status-success">
                    +{formatCurrency(preview.cashIn)}đ
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">− Chi tiền mặt</span>
                  <span className="font-medium tabular-nums text-status-error">
                    −{formatCurrency(preview.cashOut)}đ
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-primary/30">
                  <span className="font-semibold">Tiền mặt dự kiến</span>
                  <span className="font-bold text-base tabular-nums text-primary">
                    {formatCurrency(preview.expectedCash)}đ
                  </span>
                </div>
              </div>

              {/* Actual cash + variance */}
              <div>
                <Label className="font-semibold">Tiền mặt thực tế đếm được *</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder="Nhập số tiền đếm trong két..."
                  className="mt-1 text-lg h-11"
                  /* autoFocus bỏ — mobile keyboard jump làm mất tóm tắt ca ở trên */
                />
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
                      name={variance === 0 ? "check_circle" : variance > 0 ? "add_circle" : "remove_circle"}
                      size={18}
                    />
                    {variance === 0
                      ? "Khớp quỹ — không chênh lệch"
                      : variance > 0
                        ? `Thừa ${formatCurrency(variance)}đ so với dự kiến`
                        : `Thiếu ${formatCurrency(Math.abs(variance))}đ so với dự kiến`}
                  </div>
                )}
              </div>

              {/* Lý do — bắt buộc */}
              <div>
                <Label className="font-semibold">Lý do đối chiếu muộn *</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="VD: Trang về sớm quên đóng / Mất điện / ..."
                  className="mt-1"
                  maxLength={200}
                />
                {!reasonValid && reason && (
                  <p className="mt-1 text-xs text-status-error">
                    Phải nhập ít nhất 3 ký tự
                  </p>
                )}
              </div>

              {/* Ghi chú */}
              <div>
                <Label>Ghi chú nội bộ (tuỳ chọn)</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Thông tin thêm..."
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Để sau
            </Button>
            <Button
              onClick={() => setShowConfirm(true)}
              // BUG FIX 2: cho phép nhập 0 (két trống thật) — check string ""
              // thay vì !actualCash (truthy của "0" string là true rồi nhưng
              // !"" là true; logic cần precise check). Plus reasonValid.
              disabled={
                !preview ||
                actualCash === "" ||
                !reasonValid ||
                loading
              }
              className="bg-status-success text-on-success hover:bg-status-success/90"
            >
              Đối chiếu &amp; chốt ca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm popup — không thể hoàn tác */}
      <Dialog open={showConfirm} onOpenChange={(o) => !loading && setShowConfirm(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="warning" className="text-status-warning" />
              Xác nhận đối chiếu
            </DialogTitle>
            <DialogDescription>
              Hành động này CHỐT SỐ LIỆU vào báo cáo và KHÔNG THỂ HOÀN TÁC.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cashier:</span>
              <span className="font-bold">{shift.cashierName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Doanh thu:</span>
              <span className="font-bold tabular-nums">
                {formatCurrency(preview?.totalSales ?? 0)}đ
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tiền mặt dự kiến:</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(preview?.expectedCash ?? 0)}đ
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tiền mặt thực tế:</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(actualCashNum)}đ
              </span>
            </div>
            {variance !== 0 && (
              <div
                className={cn(
                  "flex justify-between pt-2 border-t",
                  variance > 0 ? "text-status-warning" : "text-status-error",
                )}
              >
                <span className="font-semibold">Chênh lệch:</span>
                <span className="font-bold tabular-nums">
                  {variance > 0 ? "+" : ""}
                  {formatCurrency(variance)}đ
                </span>
              </div>
            )}
            <div className="pt-2 border-t text-xs text-muted-foreground">
              <strong>Lý do:</strong> {reason}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={loading}>
              Xem lại
            </Button>
            <Button onClick={handleConfirm} disabled={loading}>
              {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
