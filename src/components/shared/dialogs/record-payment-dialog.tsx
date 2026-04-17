"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  recordInvoicePayment,
  recordPurchasePayment,
} from "@/lib/services/supabase/payments";
import { Icon } from "@/components/ui/icon";

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** "invoice" for customer debt, "purchase_order" for supplier debt */
  type: "invoice" | "purchase_order";
  referenceId: string;
  referenceCode: string;
  counterpartyName: string;
  currentDebt: number;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  onSuccess,
  type,
  referenceId,
  referenceCode,
  counterpartyName,
  currentDebt,
}: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">("cash");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const isInvoice = type === "invoice";
  const title = isInvoice ? "Ghi nhận thu nợ" : "Ghi nhận trả nợ NCC";
  const label = isInvoice ? "hóa đơn" : "đơn nhập hàng";

  useEffect(() => {
    if (open) {
      setAmount(currentDebt);
      setPaymentMethod("cash");
      setNote("");
      setErrors({});
      setSaving(false);
    }
  }, [open, currentDebt]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (amount <= 0) newErrors.amount = "Số tiền phải lớn hơn 0";
    if (amount > currentDebt) newErrors.amount = `Vượt quá công nợ (${formatCurrency(currentDebt)})`;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const input = {
        referenceId,
        amount,
        paymentMethod,
        note: note || undefined,
      };

      const result = isInvoice
        ? await recordInvoicePayment(input)
        : await recordPurchasePayment(input);

      onOpenChange(false);
      toast({
        title: isInvoice ? "Thu nợ thành công" : "Trả nợ NCC thành công",
        description: `${result.cashCode} — ${formatCurrency(amount)}. Công nợ còn lại: ${formatCurrency(result.newDebt)}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi ghi nhận thanh toán",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {referenceCode} — {counterpartyName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Debt info */}
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Công nợ hiện tại ({label})</span>
              <span className="font-semibold text-destructive">
                {formatCurrency(currentDebt)}
              </span>
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Số tiền thanh toán <span className="text-destructive">*</span>
            </label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              placeholder="Nhập số tiền"
              aria-invalid={!!errors.amount}
            />
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount}</p>
            )}
            {amount > 0 && amount < currentDebt && (
              <p className="text-xs text-muted-foreground">
                Còn lại sau thanh toán: {formatCurrency(currentDebt - amount)}
              </p>
            )}
            {amount === currentDebt && currentDebt > 0 && (
              <p className="text-xs text-emerald-600">
                Thanh toán hết nợ
              </p>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phương thức thanh toán</label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "transfer" | "card")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tiền mặt</SelectItem>
                <SelectItem value="transfer">Chuyển khoản</SelectItem>
                <SelectItem value="card">Thẻ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú thanh toán"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            {isInvoice ? "Thu tiền" : "Trả tiền"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
