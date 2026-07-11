"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Dialog nhập lý do dùng chung (từ chối, cần trao đổi, huỷ, ép hoàn tất,
 * miễn readiness, override…). Lý do bắt buộc — backend cũng enforce MISSING_REASON.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Lý do",
  placeholder = "Nhập lý do…",
  confirmLabel = "Xác nhận",
  variant = "default",
  minLength = 3,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
  minLength?: number;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length >= minLength;

  async function handleConfirm() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (loading) return;
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="mkt-reason">{label}</Label>
          <Textarea
            id="mkt-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            rows={3}
            autoFocus
          />
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button variant={variant} disabled={loading || !valid} onClick={handleConfirm}>
            {loading ? "Đang xử lý…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
