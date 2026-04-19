"use client";

/** FnbCart — Right sidebar cart panel for F&B POS */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { FnbTabSnapshot, FnbOrderLine, FnbDiscountInput } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";

interface FnbCartProps {
  activeTab: FnbTabSnapshot | undefined;
  subtotal: number;
  total: number;
  orderDiscountAmount: number;
  lineCount: number;
  updateLineQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  onSendToKitchen: () => void;
  onPayment: () => void;
  onSplitBill?: () => void;
  onCustomerClick?: () => void;
  onDiscountChange?: (discount: FnbDiscountInput | undefined) => void;
  onPrintPreBill?: () => void;
  /** When true, show full-width (no hidden lg:flex) */
  mobile?: boolean;
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Tại quán",
  takeaway: "Mang về",
  delivery: "Giao hàng",
};

export function FnbCart({
  activeTab,
  subtotal,
  total,
  orderDiscountAmount,
  lineCount,
  updateLineQty,
  removeLine,
  onSendToKitchen,
  onPayment,
  onSplitBill,
  onCustomerClick,
  onDiscountChange,
  onPrintPreBill,
  mobile,
}: FnbCartProps) {
  const lines = activeTab?.lines ?? [];
  const isEmpty = lines.length === 0;
  const orderTypeLabel =
    ORDER_TYPE_LABEL[activeTab?.orderType ?? "takeaway"] ?? "Mang về";

  // Stitch FnB POS mockup: cart sidebar
  // - Container: bg-surface-container-lowest rounded-xl ambient-shadow border
  // - Header: tên đơn + badge loại + icons actions
  // - Order type 3 buttons pill row
  // - Items: bg-surface p-3 rounded-lg với qty controls bg-surface-container-low
  // - Footer: summary + 2 primary buttons (Bếp F10 / Thanh toán F9)
  return (
    <div className={cn(
      "flex flex-col bg-surface-container-lowest h-full overflow-hidden",
      mobile
        ? "w-full"
        : "w-[300px] md:w-[340px] lg:w-[360px] hidden lg:flex rounded-xl ambient-shadow border border-outline-variant/20 my-3 mr-3"
    )}>
      {/* ── Header ── */}
      <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="font-heading text-base font-bold text-foreground truncate">
              {activeTab?.label ?? "Đơn hàng"}
            </h2>
            {!isEmpty && (
              <Badge
                variant="secondary"
                className="text-[10px] shrink-0 bg-surface-container-high text-on-surface-variant border-0 font-semibold"
              >
                {lineCount} món
              </Badge>
            )}
            {activeTab?.kitchenOrderId && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-info/10 text-status-info text-[10px] font-semibold shrink-0"
                title="Đơn đã được gửi xuống bếp. Thêm món sẽ gửi bổ sung."
              >
                <Icon name="ramen_dining" size={11} />
                Đã gửi bếp
              </span>
            )}
          </div>
        </div>

        {/* Customer bar — Stitch style */}
        <button
          type="button"
          onClick={onCustomerClick}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low text-sm text-foreground hover:bg-surface-container transition-colors press-scale-sm"
        >
          <Icon name="person" size={16} className="text-muted-foreground shrink-0" />
          <span className="truncate flex-1 text-left">
            {activeTab?.customerName ?? "Khách lẻ"}
          </span>
          <kbd className="text-[10px] text-muted-foreground font-mono bg-surface-container-lowest border border-outline-variant/30 rounded px-1.5 py-0.5">
            F4
          </kbd>
        </button>
      </div>

      {/* Order type badge row (display current) */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-fixed text-primary text-xs font-semibold">
          <Icon
            name={
              activeTab?.orderType === "dine_in"
                ? "restaurant"
                : activeTab?.orderType === "delivery"
                  ? "local_shipping"
                  : "takeout_dining"
            }
            size={14}
          />
          {orderTypeLabel}
        </div>
      </div>

      {/* ── Cart lines ── */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 px-6 text-center">
          <div className="size-16 rounded-2xl bg-surface-container-low flex items-center justify-center">
            <Icon name="local_cafe" size={32} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium">Chưa có món nào</p>
          <p className="text-xs text-muted-foreground">
            Chọn món từ thực đơn để thêm vào đơn
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3 flex flex-col gap-2">
            {lines.map((line) => (
              <CartLineItem
                key={line.id}
                line={line}
                onUpdateQty={(qty) => updateLineQty(line.id, qty)}
                onRemove={() => removeLine(line.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* ── Footer: totals + discount + actions ── */}
      <div className="border-t border-outline-variant/20 bg-surface-container-lowest p-4 shrink-0 space-y-2.5">
        {/* Subtotal */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Tạm tính</span>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {formatCurrency(subtotal)}
          </span>
        </div>

        {/* Discount controls */}
        {!isEmpty && onDiscountChange && (
          <DiscountRow
            discount={activeTab?.orderDiscount}
            onChange={onDiscountChange}
          />
        )}

        {/* Discount display */}
        {orderDiscountAmount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-status-warning">Giảm giá</span>
            <span className="text-sm font-medium text-status-warning tabular-nums">
              -{formatCurrency(orderDiscountAmount)}
            </span>
          </div>
        )}

        {/* Total — Stitch style: bold xl primary */}
        <div className="flex items-center justify-between border-t border-outline-variant/20 pt-3">
          <span className="text-sm font-semibold text-foreground">Khách cần trả</span>
          <span className="font-heading text-2xl font-extrabold text-primary tabular-nums tracking-tight">
            {formatCurrency(total)}
          </span>
        </div>

        {!isEmpty && (
          <div className="flex gap-2">
            {onPrintPreBill && (
              <Button
                variant="outline"
                onClick={onPrintPreBill}
                className="flex-1 h-9 text-xs rounded-lg border-outline-variant/40"
              >
                <Icon name="description" size={14} className="mr-1" />
                Tạm tính
              </Button>
            )}
            {onSplitBill && activeTab?.kitchenOrderId && lines.length > 1 && (
              <Button
                variant="outline"
                onClick={onSplitBill}
                className="flex-1 h-9 text-xs rounded-lg border-outline-variant/40"
              >
                <Icon name="content_cut" size={14} className="mr-1" />
                Tách bill
              </Button>
            )}
          </div>
        )}

        {/* Primary actions row — Stitch spec: 40/60 split */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onSendToKitchen}
            disabled={isEmpty}
            className={cn(
              "flex-[0.4] h-14 rounded-xl font-semibold text-sm flex flex-col items-center justify-center gap-0.5 transition-all press-scale-sm",
              activeTab?.kitchenOrderId
                ? "bg-status-info/15 text-status-info hover:bg-status-info/25 disabled:opacity-40 disabled:pointer-events-none"
                : "bg-surface-container-high text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            <Icon name={activeTab?.kitchenOrderId ? "add_circle" : "notifications_active"} size={18} />
            <span className="text-xs leading-none">
              {activeTab?.kitchenOrderId ? "Gửi thêm (F10)" : "Bếp (F10)"}
            </span>
          </button>
          <button
            type="button"
            onClick={onPayment}
            disabled={isEmpty}
            className={cn(
              "flex-[0.6] h-14 rounded-xl font-bold text-sm flex flex-col items-center justify-center gap-0.5 transition-all press-scale-sm ambient-shadow",
              "bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            <Icon name="payments" size={18} />
            <span className="text-xs leading-none">Thanh toán (F9)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscountRow({
  discount,
  onChange,
}: {
  discount: FnbDiscountInput | undefined;
  onChange: (d: FnbDiscountInput | undefined) => void;
}) {
  const mode = discount?.mode ?? "amount";
  const [localValue, setLocalValue] = useState(
    discount?.value ? String(discount.value) : ""
  );

  const handleValueChange = (v: string) => {
    setLocalValue(v);
    const num = parseInt(v.replace(/\D/g, ""), 10);
    if (!v || Number.isNaN(num) || num <= 0) {
      onChange(undefined);
    } else {
      onChange({ mode, value: num });
    }
  };

  const toggleMode = () => {
    const newMode = mode === "amount" ? "percent" : "amount";
    const num = parseInt(localValue.replace(/\D/g, ""), 10);
    if (localValue && !Number.isNaN(num) && num > 0) {
      onChange({ mode: newMode, value: num });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground shrink-0">Giảm giá</span>
      <Input
        type="text"
        inputMode="numeric"
        value={localValue}
        onChange={(e) => handleValueChange(e.target.value)}
        placeholder="0"
        className="h-9 md:h-7 text-sm md:text-xs flex-1 min-w-0 tabular-nums"
      />
      <button
        type="button"
        onClick={toggleMode}
        className={cn(
          "h-9 w-9 md:h-7 md:w-7 rounded border flex items-center justify-center shrink-0 transition-colors",
          mode === "percent"
            ? "bg-primary-fixed border-primary text-primary"
            : "bg-surface-container-low border-border text-muted-foreground"
        )}
        title={mode === "percent" ? "Phần trăm" : "Số tiền"}
      >
        {mode === "percent" ? (
          <Icon name="percent" size={14} className="md:h-3 md:w-3" />
        ) : (
          <span className="text-xs md:text-[10px] font-bold">đ</span>
        )}
      </button>
    </div>
  );
}

function CartLineItem({
  line,
  onUpdateQty,
  onRemove,
}: {
  line: FnbOrderLine;
  onUpdateQty: (qty: number) => void;
  onRemove: () => void;
}) {
  // Stitch FnB mockup cart line:
  // - Wrap card: bg-surface-container-low rounded-lg p-3
  // - Name font-heading semibold + line-total text-primary
  // - Qty controls: pill group bg-surface-container rounded-full
  // - Remove: subtle icon top-right, visible on hover
  return (
    <div className="group relative bg-surface-container-low rounded-lg p-3 hover:bg-surface-container transition-colors">
      <div className="flex items-start justify-between gap-2">
        {/* Name + variant */}
        <div className="flex-1 min-w-0">
          <p className="font-heading text-sm font-semibold text-foreground leading-tight">
            {line.productName}
          </p>
          {line.variantLabel && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {line.variantLabel}
            </p>
          )}
        </div>

        {/* Line total — primary color per Stitch */}
        <span className="text-sm font-bold text-primary shrink-0 tabular-nums">
          {formatCurrency(line.lineTotal)}
        </span>
      </div>

      {/* Toppings */}
      {line.toppings.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {line.toppings.map((t, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              + {t.name} x{t.quantity}{" "}
              <span className="text-muted-foreground/80 tabular-nums">
                {formatCurrency(t.price)}
              </span>
            </p>
          ))}
        </div>
      )}
      {line.note && (
        <p className="text-[11px] text-status-warning mt-1 italic">
          &ldquo;{line.note}&rdquo;
        </p>
      )}

      {/* Qty controls + remove — Stitch pill group */}
      <div className="flex items-center justify-between mt-2.5">
        <div className="inline-flex items-center gap-0.5 bg-surface-container-lowest rounded-full p-0.5 border border-outline-variant/15">
          <button
            type="button"
            onClick={() => onUpdateQty(line.quantity - 1)}
            className="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-high hover:text-foreground active:bg-surface-container transition-colors press-scale-sm"
            aria-label="Giảm số lượng"
          >
            <Icon name="remove" size={14} />
          </button>
          <span className="text-sm font-semibold w-6 text-center tabular-nums text-foreground">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => onUpdateQty(line.quantity + 1)}
            className="size-7 rounded-full flex items-center justify-center text-primary hover:bg-primary-fixed active:bg-primary-fixed/70 transition-colors press-scale-sm"
            aria-label="Tăng số lượng"
          >
            <Icon name="add" size={14} />
          </button>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-status-error hover:bg-status-error/10 transition-colors opacity-60 md:opacity-0 md:group-hover:opacity-100 press-scale-sm"
          title="Xoá"
          aria-label="Xoá món"
        >
          <Icon name="delete" size={15} />
        </button>
      </div>
    </div>
  );
}
