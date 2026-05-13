"use client";

/**
 * SetPinDialog — owner/admin/manager đặt PIN POS 6 số cho cashier.
 *
 * Sprint B.4 (CEO 12/05/2026, Approach Z): PIN này dùng để cashier switch
 * user nhanh trên tablet POS FnB (thay vì gõ email + password).
 *
 * Khác PIN supervisor cũ (đã bị bỏ ở B.6): PIN này per-user, có audit log,
 * khoá sau 10 lần sai, manager có thể reset bất kỳ lúc nào.
 *
 * UX:
 *   - 6 ô digit input (paste support)
 *   - Re-confirm PIN ở ô thứ 2 → tránh đánh máy sai
 *   - Nút "Sinh PIN ngẫu nhiên" cho lười nghĩ
 *   - Warning "đọc cho nhân viên qua điện thoại / ghi lên thẻ riêng, KHÔNG
 *     nhắn qua Zalo / SMS"
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

interface SetPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tên người được đặt PIN (hiển thị title). */
  targetUserName: string;
  /** Đã từng đặt PIN trước → label "Đổi PIN" thay vì "Đặt PIN". */
  hasExistingPin?: boolean;
  /** Callback chạy khi user nhập 2 PIN khớp + bấm xác nhận. Pass PIN 6 số. */
  onConfirm: (pin: string) => void | Promise<void>;
}

export function SetPinDialog({
  open,
  onOpenChange,
  targetUserName,
  hasExistingPin = false,
  onConfirm,
}: SetPinDialogProps) {
  const [pinStep1, setPinStep1] = useState<string[]>(["", "", "", "", "", ""]);
  const [pinStep2, setPinStep2] = useState<string[]>(["", "", "", "", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs1 = useRef<(HTMLInputElement | null)[]>([]);
  const inputRefs2 = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state khi mở
  useEffect(() => {
    if (open) {
      setPinStep1(["", "", "", "", "", ""]);
      setPinStep2(["", "", "", "", "", ""]);
      setError(null);
      setSubmitting(false);
      setTimeout(() => inputRefs1.current[0]?.focus(), 80);
    }
  }, [open]);

  const pin1 = pinStep1.join("");
  const pin2 = pinStep2.join("");
  const pin1Ready = pin1.length === 6;
  const pin2Ready = pin2.length === 6;
  const pinsMatch = pin1Ready && pin2Ready && pin1 === pin2;

  const handleConfirm = useCallback(async () => {
    if (!pinsMatch || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(pin1);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đặt PIN thất bại");
    } finally {
      setSubmitting(false);
    }
  }, [pinsMatch, submitting, pin1, onConfirm, onOpenChange]);

  const handleDigitChange = (
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    digits: string[],
    setDigits: (d: string[]) => void,
    index: number,
    value: string,
  ) => {
    const sanitized = value.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[index] = sanitized;
    setDigits(next);
    setError(null);
    if (sanitized && index < 5) {
      refs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    digits: string[],
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "Enter" && pinsMatch) {
      handleConfirm();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < 5) {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    setDigits: (d: string[]) => void,
    e: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setError(null);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const generateRandomPin = () => {
    const random = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    const arr = random.split("");
    setPinStep1(arr);
    setPinStep2(arr);
    setError(null);
    inputRefs2.current[5]?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="pin" size={18} className="text-status-warning" />
            {hasExistingPin ? "Đổi PIN POS" : "Đặt PIN POS"}
          </DialogTitle>
          <DialogDescription>
            <span className="block text-sm font-medium text-foreground">{targetUserName}</span>
            <span className="block text-xs mt-0.5">
              PIN 6 số để nhân viên đăng nhập nhanh trên tablet POS FnB. Đọc PIN cho nhân viên qua điện thoại hoặc ghi giấy đưa riêng — TUYỆT ĐỐI không gửi qua Zalo / SMS.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: nhập PIN lần 1 */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              PIN mới (6 số)
            </label>
            <div className="flex justify-center gap-2 mt-1.5">
              {pinStep1.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs1.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={1}
                  value={d}
                  disabled={submitting}
                  onChange={(e) =>
                    handleDigitChange(inputRefs1, pinStep1, setPinStep1, i, e.target.value)
                  }
                  onKeyDown={(e) => handleKeyDown(inputRefs1, pinStep1, i, e)}
                  onPaste={i === 0 ? (e) => handlePaste(inputRefs1, setPinStep1, e) : undefined}
                  className={cn(
                    "h-12 w-10 rounded-lg border-2 text-center text-xl font-bold transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/40",
                    d
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-surface text-foreground",
                  )}
                />
              ))}
            </div>
          </div>

          {/* Step 2: re-confirm PIN */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Xác nhận lại PIN
            </label>
            <div className="flex justify-center gap-2 mt-1.5">
              {pinStep2.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs2.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={1}
                  value={d}
                  disabled={submitting || !pin1Ready}
                  onChange={(e) =>
                    handleDigitChange(inputRefs2, pinStep2, setPinStep2, i, e.target.value)
                  }
                  onKeyDown={(e) => handleKeyDown(inputRefs2, pinStep2, i, e)}
                  onPaste={i === 0 ? (e) => handlePaste(inputRefs2, setPinStep2, e) : undefined}
                  className={cn(
                    "h-12 w-10 rounded-lg border-2 text-center text-xl font-bold transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/40",
                    !pin1Ready && "opacity-50",
                    d
                      ? pinsMatch
                        ? "border-status-success bg-status-success/5 text-status-success"
                        : pin2Ready
                          ? "border-status-error bg-status-error/5 text-status-error"
                          : "border-primary bg-primary/5 text-primary"
                      : "border-border bg-surface text-foreground",
                  )}
                />
              ))}
            </div>
            {pin2Ready && !pinsMatch && (
              <p className="text-[11px] text-status-error mt-1 text-center">
                <Icon name="error" size={11} className="inline-block mr-0.5" />
                Hai PIN không khớp
              </p>
            )}
          </div>

          {/* Random PIN button */}
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={generateRandomPin}
              disabled={submitting}
              className="text-[11px] h-7"
            >
              <Icon name="casino" size={12} className="mr-1" />
              Sinh PIN ngẫu nhiên
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-status-error bg-status-error/5 border border-status-error/20 rounded-md px-3 py-2">
              <Icon name="error" size={14} className="shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleConfirm} disabled={!pinsMatch || submitting}>
            {submitting ? (
              <>
                <Icon name="progress_activity" size={14} className="mr-1 animate-spin" />
                Đang lưu...
              </>
            ) : (
              <>
                <Icon name="save" size={14} className="mr-1" />
                Lưu PIN
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
