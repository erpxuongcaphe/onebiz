"use client";

/**
 * Supervisor PIN dialog — yêu cầu quản lý nhập mã PIN để duyệt hành động
 * nhạy cảm (ví dụ: giảm giá vượt ngưỡng). Mã PIN lưu trong AppSettings
 * (sales.supervisorPin). Nếu PIN rỗng → component không nên được mở (caller
 * phải kiểm tra trước).
 *
 * Dùng chủ yếu ở POS Retail / POS FnB — nơi giảm giá thủ công cần guard.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";

interface SupervisorPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mã PIN đúng (lấy từ settings.sales.supervisorPin). */
  correctPin: string;
  /** Tiêu đề hộp thoại (ví dụ: "Duyệt giảm giá vượt ngưỡng"). */
  title?: string;
  /** Mô tả ngắn giải thích vì sao cần PIN. */
  description?: string;
  /** Callback chạy khi PIN khớp. */
  onApproved: () => void;
}

export function SupervisorPinDialog({
  open,
  onOpenChange,
  correctPin,
  title = "Cần duyệt quản lý",
  description = "Thao tác này vượt ngưỡng cho phép — mời quản lý nhập mã PIN để duyệt.",
  onApproved,
}: SupervisorPinDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state mỗi lần mở
  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setAttempts(0);
      // Focus sau 100ms để Dialog render xong
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = () => {
    if (pin.length === 0) {
      setError("Vui lòng nhập mã PIN");
      return;
    }
    if (pin === correctPin) {
      onApproved();
      onOpenChange(false);
      return;
    }
    setAttempts((a) => a + 1);
    setError("Mã PIN không đúng");
    setPin("");
    inputRef.current?.focus();
  };

  const locked = attempts >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="lock" size={18} className="text-status-warning" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Mã PIN quản lý"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !locked) handleSubmit();
            }}
            disabled={locked}
            maxLength={12}
          />
          {error && (
            <p className="text-xs text-status-error flex items-center gap-1">
              <Icon name="error" size={14} />
              {error}
            </p>
          )}
          {locked && (
            <p className="text-xs text-status-error">
              Nhập sai quá 5 lần. Đóng hộp thoại và mở lại để thử tiếp.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSubmit} disabled={locked || pin.length === 0}>
            Duyệt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
