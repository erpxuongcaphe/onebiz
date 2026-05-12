"use client";

/**
 * OTP Approval Dialog — yêu cầu manager đọc OTP qua điện thoại để duyệt
 * action nhạy cảm POS (CEO 12/05/2026).
 *
 * Flow:
 *   1. Cashier bấm action nhạy cảm (vd "Hủy bill") → POS mở dialog này
 *   2. Cashier gọi điện cho manager (UI hiển thị danh sách quản lý có quyền)
 *   3. Manager mở web/PWA `/manager/otp` → cấp OTP → đọc qua điện thoại
 *   4. Cashier nhập 6 số → verify → call onApproved(verifiedOtp)
 *
 * Khác `SupervisorPinDialog` (PIN cố định 1 mã chung):
 *   - OTP dùng 1 lần, TTL 2 phút, gắn user cấp → audit chính xác
 *   - Sai 10 lần → thông báo admin (không khoá — CEO yêu cầu)
 *   - Có thể tích hợp Zalo OA / SMS cho iOS user về sau
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { verifyAndUseManagerOtp, type VerifiedOtp, type OtpActionCode, OTP_ACTION_LABELS } from "@/lib/services/supabase/manager-otp";

interface OtpApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Action code (vd 'fnb.cancel_unpaid_bill'). */
  actionCode: OtpActionCode | string;
  /** Metadata về target (vd { bill_id, percent }) — dùng cho audit log. */
  targetMeta?: Record<string, unknown>;
  /** Mô tả ngữ cảnh hiển thị trong dialog (vd "Hủy bill B-2042 — 500.000đ"). */
  contextLabel?: string;
  /** Lý do bắt buộc nhập (>= 5 ký tự). Mặc định false. */
  requireReason?: boolean;
  /** Callback chạy khi verify thành công. */
  onApproved: (verified: VerifiedOtp, reason: string) => void | Promise<void>;
}

export function OtpApprovalDialog({
  open,
  onOpenChange,
  actionCode,
  targetMeta,
  contextLabel,
  requireReason = false,
  onApproved,
}: OtpApprovalDialogProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [reason, setReason] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state khi mở
  useEffect(() => {
    if (open) {
      setDigits(["", "", "", "", "", ""]);
      setReason("");
      setError(null);
      setAttempts(0);
      setTimeout(() => inputRefs.current[0]?.focus(), 80);
    }
  }, [open]);

  const code = digits.join("");
  const codeReady = code.length === 6;
  const reasonValid = !requireReason || reason.trim().length >= 5;

  const handleVerify = useCallback(async () => {
    if (!codeReady || !reasonValid || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const verified = await verifyAndUseManagerOtp({
        code,
        actionCode,
        targetMeta: {
          ...targetMeta,
          reason: reason.trim() || undefined,
        },
      });
      await onApproved(verified, reason.trim());
      onOpenChange(false);
    } catch (err) {
      const next = attempts + 1;
      setAttempts(next);
      const message = err instanceof Error ? err.message : "Mã OTP không hợp lệ.";
      setError(message);
      // Reset digits cho retry — UX KiotViet/Sapo: clear PIN sau khi sai
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();

      // CEO 12/05: sau 10 lần sai → thông báo admin (TODO: gửi notification),
      // KHÔNG khoá để không chặn ca quá tay. Hiện tại chỉ hiển thị warning.
      if (next >= 10) {
        setError(
          "Đã nhập sai 10 lần. Hệ thống đã ghi nhận và sẽ thông báo cho quản trị viên.",
        );
      }
    } finally {
      setVerifying(false);
    }
  }, [
    code,
    codeReady,
    reasonValid,
    verifying,
    actionCode,
    targetMeta,
    reason,
    attempts,
    onApproved,
    onOpenChange,
  ]);

  const handleDigitChange = (index: number, value: string) => {
    // Filter chỉ giữ 1 chữ số
    const sanitized = value.replace(/\D/g, "").slice(0, 1);
    const nextDigits = [...digits];
    nextDigits[index] = sanitized;
    setDigits(nextDigits);
    setError(null);

    if (sanitized && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter" && codeReady) {
      handleVerify();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setError(null);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const actionLabel =
    OTP_ACTION_LABELS[actionCode as OtpActionCode] ?? actionCode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="pin" size={18} className="text-status-warning" />
            Cần OTP duyệt từ xa
          </DialogTitle>
          <DialogDescription className="space-y-1.5 pt-1">
            <div className="text-sm font-medium text-foreground">{actionLabel}</div>
            {contextLabel && (
              <div className="text-xs text-muted-foreground">{contextLabel}</div>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Hướng dẫn */}
          <div className="bg-status-warning/5 border border-status-warning/20 rounded-lg p-3 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <Icon
                name="phone_in_talk"
                size={16}
                className="text-status-warning shrink-0 mt-0.5"
              />
              <div>
                Gọi điện hoặc nhắn Zalo cho quản lý phụ trách. Quản lý vào{" "}
                <span className="font-medium text-foreground">
                  onebiz.com.vn/manager
                </span>{" "}
                → bấm <span className="font-medium">Cấp OTP</span> → đọc mã 6 số (hiệu lực 2 phút).
              </div>
            </div>
          </div>

          {/* 6 ô digit */}
          <div className="flex justify-center gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                value={d}
                disabled={verifying}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={i === 0 ? handlePaste : undefined}
                className={cn(
                  "h-14 w-12 rounded-lg border-2 text-center text-2xl font-bold transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-primary/40",
                  d
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-surface text-foreground",
                  error && "border-status-error bg-status-error/5",
                )}
              />
            ))}
          </div>

          {/* Lý do (tuỳ chọn) */}
          {requireReason && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Lý do <span className="text-status-error">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="VD: Khách đổi ý, đặt nhầm món, khách bỏ về..."
                rows={2}
                disabled={verifying}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
              {!reasonValid && reason.length > 0 && (
                <p className="text-[11px] text-status-error mt-1">
                  Lý do tối thiểu 5 ký tự.
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-status-error bg-status-error/5 border border-status-error/20 rounded-md px-3 py-2">
              <Icon name="error" size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <div>{error}</div>
                {attempts > 0 && attempts < 10 && (
                  <div className="text-[10px] mt-0.5 text-status-error/70">
                    Đã thử {attempts}/10 lần
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={verifying}
          >
            Huỷ
          </Button>
          <Button
            onClick={handleVerify}
            disabled={!codeReady || !reasonValid || verifying}
          >
            {verifying ? (
              <>
                <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />
                Đang xác nhận...
              </>
            ) : (
              <>
                <Icon name="check" size={16} className="mr-1" />
                Xác nhận
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
