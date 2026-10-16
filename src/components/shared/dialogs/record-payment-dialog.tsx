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
  getDocumentAdvanceAvailable,
  getPaymentDocumentBranch,
} from "@/lib/services/supabase/payments";
import { ApplyAdvanceDialog } from "@/components/shared/dialogs/apply-advance-dialog";
import { Icon } from "@/components/ui/icon";
import { CashTimeFields, useCashTimeDraft } from "@/components/shared/cash-time-fields";
import { cashInputToIso, validateCashTime } from "@/lib/cash-time";
import { MoneyAccountSelect } from "@/components/shared/money-account-select";
import { NumericInput } from "@/components/ui/numeric-input";

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
  const [documentBranch,setDocumentBranch] = useState<string>();
  const [moneyAccountId,setMoneyAccountId] = useState("");
  useEffect(()=>{setMoneyAccountId("");},[open,referenceId,paymentMethod]);
  useEffect(()=>{
    if(!open)return;let active=true;setDocumentBranch(undefined);
    getPaymentDocumentBranch(type,referenceId).then(b=>{if(active)setDocumentBranch(b);}).catch(()=>{});
    return ()=>{active=false;};
  },[open,type,referenceId]);
  const [remainingDebt, setRemainingDebt] = useState(currentDebt);
  const [availableAdvance, setAvailableAdvance] = useState(0);
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const {cashTime,setCashTime} = useCashTimeDraft(open);

  const isInvoice = type === "invoice";
  const title = isInvoice ? "Ghi nhận thu nợ" : "Ghi nhận trả nợ NCC";
  const label = isInvoice ? "hóa đơn" : "đơn nhập hàng";

  useEffect(() => {
    if (open) {
      setAmount(currentDebt);
      setRemainingDebt(currentDebt);
      setApplyOpen(false);
      setPaymentMethod("cash");
      setNote("");
      setErrors({});
      setSaving(false);
    }
  }, [open, currentDebt, referenceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAvailableAdvance(0); setAdvanceLoading(true); setAdvanceError(null);
    getDocumentAdvanceAvailable(type, referenceId)
      .then(value => { if (!cancelled) setAvailableAdvance(value); })
      .catch(err => { if (!cancelled) setAdvanceError(err instanceof Error ? err.message : "Chưa kiểm tra được tiền ứng."); })
      .finally(() => { if (!cancelled) setAdvanceLoading(false); });
    return () => { cancelled = true; };
  }, [open, type, referenceId]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (amount <= 0) newErrors.amount = "Số tiền phải lớn hơn 0";
    if (isInvoice && amount > remainingDebt) {
      newErrors.amount = `Vượt quá công nợ (${formatCurrency(remainingDebt)})`;
    }
    if (note.trim().length < 3) newErrors.note = "Ghi rõ nội dung thu/chi để đối soát khoản thanh toán.";
    const timeError=validateCashTime(cashTime.occurredLocal,cashTime.transactionDate,cashTime.timeReason);
    if(timeError) newErrors.time=timeError;
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
        moneyAccountId: moneyAccountId || null,
        note: `${note.trim()} · ${referenceCode} · ${counterpartyName}`,
        occurredAt: cashInputToIso(cashTime.occurredLocal),
        transactionDate: cashTime.transactionDate,
        timeReason: cashTime.timeReason,
      };

      const result = isInvoice
        ? await recordInvoicePayment(input)
        : await recordPurchasePayment(input);

      onOpenChange(false);
      toast({
        title: isInvoice ? "Thu nợ thành công" : "Trả nợ NCC thành công",
        description:
          result.advanceAmount > 0
            ? `${result.cashCode} — trả nợ ${formatCurrency(result.appliedAmount)}, ứng trước NCC ${formatCurrency(result.advanceAmount)}.`
            : `${result.cashCode} — ${formatCurrency(amount)}. Công nợ còn lại: ${formatCurrency(result.newDebt)}`,
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
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
                {formatCurrency(remainingDebt)}
              </span>
            </div>
          </div>

          {advanceLoading ? <p className="text-sm text-muted-foreground">Đang kiểm tra tiền ứng...</p> : advanceError ? <p role="alert" className="text-sm text-status-warning">Chưa kiểm tra được tiền ứng. {advanceError}</p> : availableAdvance > 0 && remainingDebt > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-success/30 bg-status-success/5 p-3 text-sm">
            <span>Tiền ứng có thể dùng: <strong className="tabular-nums">{formatCurrency(availableAdvance)}</strong></span>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setApplyOpen(true)}><Icon name="link" size={16} />Cấn tiền ứng</Button>
          </div> : null}

          {/* Amount */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Số tiền thanh toán <span className="text-destructive">*</span>
            </label>
            <NumericInput
              aria-label="Số tiền thanh toán"
              value={amount}
              onChange={(value) => setAmount(value || 0)}
              placeholder="Nhập số tiền"
              aria-invalid={!!errors.amount}
            />
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount}</p>
            )}
            {amount > 0 && amount < remainingDebt && (
              <p className="text-xs text-muted-foreground">
                Còn lại sau thanh toán: {formatCurrency(remainingDebt - amount)}
              </p>
            )}
            {amount === remainingDebt && remainingDebt > 0 && (
              <p className="text-xs text-status-success">
                Thanh toán hết nợ
              </p>
            )}
            {!isInvoice && amount > remainingDebt && (
              <div className="rounded-md border border-status-warning/30 bg-status-warning/10 p-2 text-xs">
                <p className="font-medium text-status-warning">
                  Trả hết nợ: {formatCurrency(remainingDebt)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Ứng trước NCC: {formatCurrency(amount - remainingDebt)}. Khoản này được theo dõi riêng, không làm công nợ phiếu nhập thành số âm.
                </p>
              </div>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-2">
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (errors.note) setErrors((prev) => ({ ...prev, note: "" }));
              }}
              placeholder="Ghi chú thanh toán"
              rows={2}
            />
            {errors.note && (
              <p className="text-xs text-destructive">{errors.note}</p>
            )}
          </div>
        </div>

        <MoneyAccountSelect branchId={documentBranch} method={paymentMethod} value={moneyAccountId} onChange={setMoneyAccountId} disabled={saving}/>
        <CashTimeFields value={cashTime} onChange={setCashTime} error={errors.time} />
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
    {applyOpen && <ApplyAdvanceDialog
      open={applyOpen} onOpenChange={setApplyOpen}
      mode={isInvoice ? "customer" : "supplier"}
      partyName={counterpartyName} referenceId={referenceId} referenceCode={referenceCode}
      debt={remainingDebt} availableAdvance={availableAdvance}
      onSuccess={result => {
        setApplyOpen(false);
        setRemainingDebt(result.remainingDebt);
        setAmount(result.remainingDebt);
        setAvailableAdvance(value => Math.max(0, value - result.appliedAmount));
        if (result.remainingDebt <= 0) onOpenChange(false);
        onSuccess?.();
      }}
    />}
    </>
  );
}
