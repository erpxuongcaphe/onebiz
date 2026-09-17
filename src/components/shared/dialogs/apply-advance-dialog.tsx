"use client";

import { useEffect, useMemo, useState } from "react";
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
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  applyCustomerAdvanceToInvoice,
  applySupplierAdvanceToPurchaseOrder,
} from "@/lib/services/supabase/payments";

interface ApplyAdvanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "customer" | "supplier";
  partyName: string;
  referenceId: string;
  referenceCode: string;
  debt: number;
  availableAdvance: number;
  onSuccess?: () => void;
}

/**
 * Applies already-recorded money only. It intentionally contains no payment
 * method: the cash transaction belongs to the original deposit/advance.
 */
export function ApplyAdvanceDialog({
  open,
  onOpenChange,
  mode,
  partyName,
  referenceId,
  referenceCode,
  debt,
  availableAdvance,
  onSuccess,
}: ApplyAdvanceDialogProps) {
  const { toast } = useToast();
  const maximum = useMemo(
    () => Math.max(0, Math.min(debt, availableAdvance)),
    [debt, availableAdvance],
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(String(Math.round(maximum)));
      setNote("");
    }
  }, [maximum, open]);

  const isCustomer = mode === "customer";
  const documentLabel = isCustomer ? "hóa đơn" : "phiếu nhập";
  const title = isCustomer ? "Cấn tiền khách trả trước" : "Cấn tiền ứng trước NCC";

  const submit = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > maximum) {
      toast({
        title: "Số tiền phân bổ không hợp lệ",
        description: `Chỉ được phân bổ tối đa ${formatCurrency(maximum)}.`,
        variant: "error",
      });
      return;
    }
    if (note.trim().length < 3) {
      toast({
        title: "Cần ghi chú phân bổ",
        description: "Ghi rõ lý do để kế toán đối soát nguồn tiền và chứng từ.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const result = isCustomer
        ? await applyCustomerAdvanceToInvoice({
            referenceId,
            amount: numericAmount,
            note: note.trim(),
          })
        : await applySupplierAdvanceToPurchaseOrder({
            referenceId,
            amount: numericAmount,
            note: note.trim(),
          });
      toast({
        title: "Đã phân bổ tiền ứng",
        description: `Đã cấn ${formatCurrency(result.appliedAmount)} vào ${referenceCode}. Còn nợ ${formatCurrency(result.remainingDebt)}.`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Không phân bổ được tiền ứng",
        description: error instanceof Error ? error.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="account_balance_wallet" size={20} className="text-status-success" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {partyName} · {documentLabel} {referenceCode}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <div>
            <div className="text-muted-foreground">Tiền ứng còn lại</div>
            <div className="font-semibold text-status-success tabular-nums">
              {formatCurrency(availableAdvance)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Công nợ chứng từ</div>
            <div className="font-semibold text-destructive tabular-nums">
              {formatCurrency(debt)}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="apply-advance-amount" className="text-sm font-medium">
              Số tiền cấn <span className="text-destructive">*</span>
            </label>
            <Input
              id="apply-advance-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={maximum}
              step={1000}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tối đa {formatCurrency(maximum)}. Hệ thống lấy các khoản ứng cũ nhất trước, cùng đối tượng và chi nhánh.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="apply-advance-note" className="text-sm font-medium">
              Lý do phân bổ <span className="text-destructive">*</span>
            </label>
            <Input
              id="apply-advance-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="VD: Cấn tiền cọc vào chứng từ này"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button onClick={submit} disabled={saving || maximum <= 0}>
            <Icon name="link" size={16} />
            {saving ? "Đang phân bổ..." : "Xác nhận phân bổ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
