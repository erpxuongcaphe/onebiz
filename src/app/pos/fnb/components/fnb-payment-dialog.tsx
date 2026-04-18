"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, CreditCard, ArrowRightLeft, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

// ── Types ──

export type PaymentMethod = "cash" | "transfer" | "card" | "mixed";

export interface FnbPaymentConfirmPayload {
  paymentMethod: PaymentMethod;
  paid: number;
  paymentBreakdown?: { cash: number; transfer: number; card: number };
  customerName: string;
}

interface FnbPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  discountAmount?: number;
  total: number;
  lineCount: number;
  orderNumber?: string;
  onConfirm: (payload: FnbPaymentConfirmPayload) => void;
}

const METHODS: { key: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { key: "cash", label: "Tiền mặt", icon: Banknote },
  { key: "transfer", label: "Chuyển khoản", icon: ArrowRightLeft },
  { key: "card", label: "Thẻ", icon: CreditCard },
  { key: "mixed", label: "Hỗn hợp", icon: Layers },
];

const DENOMINATIONS = [50_000, 100_000, 200_000, 500_000, 1_000_000];

function parseAmount(v: string): number {
  const n = parseInt(v.replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

function formatDenom(v: number): string {
  if (v >= 1_000_000) return `${v / 1_000_000}M`;
  return `${v / 1_000}k`;
}

// ── Component ──

export function FnbPaymentDialog({
  open, onOpenChange, subtotal, discountAmount = 0, total, lineCount, orderNumber, onConfirm,
}: FnbPaymentDialogProps) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [cardInput, setCardInput] = useState("");
  const [customerName, setCustomerName] = useState("Khách lẻ");

  useEffect(() => {
    if (open) {
      setMethod("cash");
      setCashInput(""); setTransferInput(""); setCardInput("");
      setCustomerName("Khách lẻ");
    }
  }, [open]);

  const cashAmount = parseAmount(cashInput);
  const transferAmount = parseAmount(transferInput);
  const cardAmount = parseAmount(cardInput);

  const totalPaid = useMemo(() => {
    if (method === "cash") return cashAmount;
    if (method === "transfer" || method === "card") return total;
    return cashAmount + transferAmount + cardAmount;
  }, [method, cashAmount, transferAmount, cardAmount, total]);

  const change = Math.max(0, totalPaid - total);
  const canConfirm = totalPaid >= total;

  const handleConfirm = () => {
    const payload: FnbPaymentConfirmPayload = {
      paymentMethod: method, paid: totalPaid,
      customerName: customerName.trim() || "Khách lẻ",
    };
    if (method === "mixed") {
      payload.paymentBreakdown = { cash: cashAmount, transfer: transferAmount, card: cardAmount };
    }
    onConfirm(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thanh toán{orderNumber ? ` — ${orderNumber}` : ""}</DialogTitle>
          <DialogDescription>{lineCount} món</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Order summary */}
          <div className="rounded-lg bg-muted px-3 py-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tạm tính</span>
              <span className="tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-status-warning">
                <span>Giảm giá</span>
                <span className="tabular-nums">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t pt-1">
              <span>Tổng cộng</span>
              <span className="text-primary tabular-nums">{formatCurrency(total)}</span>
            </div>
          </div>

          {/* Payment method tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-1.5">
            {METHODS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setMethod(key)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-3 sm:p-2 text-sm sm:text-xs transition-colors",
                  method === key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50 active:bg-muted",
                )}>
                <Icon className="h-5 w-5 sm:h-4 sm:w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Cash input (for cash & mixed) */}
          {(method === "cash" || method === "mixed") && (
            <div className="space-y-1.5">
              <Label className="text-sm">{method === "mixed" ? "Tiền mặt" : "Tiền khách đưa"}</Label>
              <Input type="text" inputMode="numeric" placeholder="0"
                value={cashInput} onChange={(e) => setCashInput(e.target.value)}
                autoFocus={method === "cash"} />
              {/* Denomination quick buttons */}
              <div className="flex flex-wrap gap-2 sm:gap-1.5">
                <button type="button"
                  onClick={() => setCashInput(String(total))}
                  className="px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md border border-status-success/25 bg-status-success/10 text-sm sm:text-xs font-medium text-status-success hover:bg-status-success/20 active:bg-status-success/30 transition-colors">
                  Đủ
                </button>
                {DENOMINATIONS.map((d) => (
                  <button key={d} type="button"
                    onClick={() => setCashInput(String(d))}
                    className="px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md border border-border bg-white text-sm sm:text-xs font-medium text-foreground hover:bg-muted active:bg-muted transition-colors tabular-nums">
                    {formatDenom(d)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Transfer & card inputs (mixed only) */}
          {method === "mixed" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm">Chuyển khoản</Label>
                <Input type="text" inputMode="numeric" placeholder="0"
                  value={transferInput} onChange={(e) => setTransferInput(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Thẻ</Label>
                <Input type="text" inputMode="numeric" placeholder="0"
                  value={cardInput} onChange={(e) => setCardInput(e.target.value)} />
              </div>
            </>
          )}

          {/* Change display */}
          {(method === "cash" || method === "mixed") && totalPaid > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Tiền thừa</span>
              <span className={cn("font-semibold", change > 0 && "text-status-success")}>
                {formatCurrency(change)}đ
              </span>
            </div>
          )}

          {/* Customer name */}
          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5">
              <Icon name="person" size={14} /> Tên khách hàng
            </Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Khách lẻ" />
          </div>
        </div>

        <DialogFooter>
          <Button className="w-full" disabled={!canConfirm} onClick={handleConfirm}>
            Hoàn tất thanh toán — {formatCurrency(total)}đ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
