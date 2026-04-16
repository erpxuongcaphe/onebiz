"use client";

/**
 * ShiftDialog — Open/Close shift dialogs for F&B POS.
 *
 * - Open: Enter starting cash → opens shift
 * - Close: Shows summary, enter actual cash → reconciles
 */

import { useState } from "react";
import { DollarSign, Clock, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { Shift } from "@/lib/types/shift";

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
            <Clock className="h-5 w-5 text-blue-600" />
            Mở ca làm việc
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <Label>Số dư đầu ca (tiền mặt trong ngăn kéo)</Label>
            <div className="relative mt-1">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
            <p className="text-xs text-muted-foreground mt-1">
              Nhập số tiền mặt hiện có khi bắt đầu ca. Để trống nếu bắt đầu từ 0.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
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
  onConfirm: (actualCash: number, note?: string) => Promise<void>;
}

export function CloseShiftDialog({
  open,
  onOpenChange,
  currentShift,
  onConfirm,
}: CloseShiftDialogProps) {
  const [actualCash, setActualCash] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (!currentShift) return null;

  const elapsed = currentShift.openedAt
    ? Math.round((Date.now() - new Date(currentShift.openedAt).getTime()) / 60_000)
    : 0;
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(Number(actualCash) || 0, note || undefined);
    } finally {
      setLoading(false);
      setActualCash("");
      setNote("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Đóng ca làm việc
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {/* Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Thời gian ca:</span>
              <span className="font-medium">{hours}h {mins}p</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Số dư đầu ca:</span>
              <span className="font-medium">{formatCurrency(currentShift.startingCash)}</span>
            </div>
          </div>

          {/* Actual cash input */}
          <div>
            <Label>Tiền mặt thực tế trong ngăn kéo</Label>
            <div className="relative mt-1">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                placeholder="Đếm tiền mặt..."
                className="pl-9 text-lg"
                autoFocus
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <Label>Ghi chú (tùy chọn)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Thiếu 50k do lỗi trả lại..."
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Đóng ca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
