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
  /** Tiền tip khách cho. Cộng vào total, ghi vào invoice.tip_amount. */
  tipAmount?: number;
}

interface FnbPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  discountAmount?: number;
  /** Total KHÔNG bao gồm tip. Tip sẽ cộng thêm trong dialog. */
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
  open, onOpenChange, subtotal, discountAmount = 0, total: baseTotal, lineCount, orderNumber, onConfirm,
}: FnbPaymentDialogProps) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [cardInput, setCardInput] = useState("");
  const [customerName, setCustomerName] = useState("Khách lẻ");
  const [allowDebt, setAllowDebt] = useState(false);
  const [tipInput, setTipInput] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("cash");
      setCashInput(""); setTransferInput(""); setCardInput("");
      setCustomerName("Khách lẻ");
      setAllowDebt(false);
      setTipInput("");
    }
  }, [open]);

  // Reset allowDebt when switching method (fresh validation each time)
  useEffect(() => {
    setAllowDebt(false);
  }, [method]);

  const cashAmount = parseAmount(cashInput);
  const transferAmount = parseAmount(transferInput);
  const cardAmount = parseAmount(cardInput);
  const tipAmount = parseAmount(tipInput);

  // Total hiện tại = base (đã bao gồm subtotal - discount + delivery + tax) + tip
  const total = baseTotal + tipAmount;

  const totalPaid = useMemo(() => {
    if (method === "cash") return cashAmount;
    if (method === "transfer" || method === "card") return total;
    return cashAmount + transferAmount + cardAmount;
  }, [method, cashAmount, transferAmount, cardAmount, total]);

  const change = Math.max(0, totalPaid - total);
  const debt = Math.max(0, total - totalPaid);
  const isFullyPaid = totalPaid >= total;
  // For mixed: each row must be ≥ 0 and at least one method used
  const mixedHasAnyAmount = method === "mixed" ? (cashAmount + transferAmount + cardAmount) > 0 : true;
  // Allow confirm if: fully paid OR user explicitly ticked "Ghi nợ"
  const canConfirm =
    mixedHasAnyAmount &&
    totalPaid > 0 &&
    (isFullyPaid || allowDebt);

  const handleConfirm = () => {
    const payload: FnbPaymentConfirmPayload = {
      paymentMethod: method, paid: totalPaid,
      customerName: customerName.trim() || "Khách lẻ",
    };
    if (tipAmount > 0) {
      payload.tipAmount = tipAmount;
    }
    if (method === "mixed") {
      payload.paymentBreakdown = { cash: cashAmount, transfer: transferAmount, card: cardAmount };
    }
    onConfirm(payload);
    onOpenChange(false);
  };

  const tipQuickButtons = [
    { label: "Không", value: 0 },
    { label: "5%", value: Math.round((baseTotal * 0.05) / 1000) * 1000 },
    { label: "10%", value: Math.round((baseTotal * 0.1) / 1000) * 1000 },
    { label: "15%", value: Math.round((baseTotal * 0.15) / 1000) * 1000 },
  ];

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
            {tipAmount > 0 && (
              <div className="flex justify-between text-status-success">
                <span>Tiền tip</span>
                <span className="tabular-nums">+{formatCurrency(tipAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t pt-1">
              <span>Tổng cộng</span>
              <span className="text-primary tabular-nums">{formatCurrency(total)}</span>
            </div>
          </div>

          {/* Tip — quick buttons + custom input */}
          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5">
              <Icon name="volunteer_activism" size={14} /> Tiền tip (tuỳ chọn)
            </Label>
            <div className="flex gap-1.5 flex-wrap">
              {tipQuickButtons.map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => setTipInput(btn.value > 0 ? String(btn.value) : "")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors tabular-nums",
                    (btn.value === 0 && tipAmount === 0) || (btn.value > 0 && tipAmount === btn.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-container-low border-border text-foreground hover:bg-surface-container",
                  )}
                >
                  {btn.label}
                  {btn.value > 0 && (
                    <span className="ml-1 text-[10px] opacity-80">
                      ({formatDenom(btn.value)})
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Hoặc nhập số tiền tuỳ ý"
              value={tipInput}
              onChange={(e) => setTipInput(e.target.value)}
              className="tabular-nums"
            />
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
                autoFocus={method === "cash"}
                className={cn(
                  "tabular-nums",
                  method === "cash" && cashAmount > 0 && cashAmount >= total
                    && "border-status-success/40 bg-status-success/5",
                  method === "cash" && cashAmount > 0 && cashAmount < total
                    && "border-status-warning/40 bg-status-warning/5",
                )}
              />
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
                  value={transferInput} onChange={(e) => setTransferInput(e.target.value)}
                  className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Thẻ</Label>
                <Input type="text" inputMode="numeric" placeholder="0"
                  value={cardInput} onChange={(e) => setCardInput(e.target.value)}
                  className="tabular-nums" />
              </div>
              {/* Mixed breakdown running total */}
              <div className="rounded-lg border bg-surface-container px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">Tổng đã nhập</span>
                  <span
                    className={cn(
                      "font-bold tabular-nums",
                      isFullyPaid ? "text-status-success" : "text-status-warning",
                    )}
                  >
                    {formatCurrency(totalPaid)} / {formatCurrency(total)} ₫
                  </span>
                </div>
                {totalPaid > 0 && totalPaid < total && (
                  <p className="text-[11px] text-status-warning">
                    Còn thiếu {formatCurrency(total - totalPaid)} ₫
                  </p>
                )}
                {totalPaid > total && (
                  <p className="text-[11px] text-status-success">
                    Thừa {formatCurrency(totalPaid - total)} ₫
                  </p>
                )}
              </div>
            </>
          )}

          {/* Info display: transfer/card auto-fills */}
          {(method === "transfer" || method === "card") && (
            <div className="rounded-lg bg-surface-container px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Icon name="info" size={14} />
              <span>Hệ thống tự ghi nhận số tiền bằng tổng hoá đơn.</span>
            </div>
          )}

          {/* Change / Debt display */}
          {(method === "cash" || method === "mixed") && totalPaid > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {debt > 0 ? "Còn nợ" : "Tiền thừa"}
              </span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  debt > 0
                    ? "text-status-warning"
                    : change > 0
                      ? "text-status-success"
                      : "text-foreground",
                )}
              >
                {formatCurrency(debt > 0 ? debt : change)}đ
              </span>
            </div>
          )}

          {/* Debt opt-in (ghi nợ) */}
          {!isFullyPaid && totalPaid > 0 && (
            <label className="flex items-center gap-2 rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={allowDebt}
                onChange={(e) => setAllowDebt(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>
                Ghi nợ {formatCurrency(total - totalPaid)}₫ — xác nhận thanh toán thiếu
              </span>
            </label>
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
