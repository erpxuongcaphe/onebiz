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

  return (
    <div className={cn(
      "flex flex-col bg-white border-l border-border h-full",
      mobile ? "w-full" : "w-[280px] md:w-[320px] lg:w-[340px] hidden lg:flex"
    )}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-surface-container-low shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-800 truncate">
            {activeTab?.label ?? "Đơn hàng"}
          </span>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {orderTypeLabel}
          </Badge>
        </div>
        {!isEmpty && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {lineCount} món
          </span>
        )}
      </div>

      {/* ── Customer bar ── */}
      <button
        type="button"
        onClick={onCustomerClick}
        className="flex items-center gap-2 px-3 py-1.5 border-b text-xs text-foreground hover:bg-surface-container-low transition-colors shrink-0"
      >
        <Icon name="person" size={14} className="text-muted-foreground" />
        <span className="truncate">{activeTab?.customerName ?? "Khách lẻ"}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">F4</span>
      </button>

      {/* ── Cart lines ── */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <Icon name="local_cafe" size={40} />
          <p className="text-sm">Chưa có món nào</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="divide-y">
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
      <div className="border-t bg-surface-container-low p-4 md:p-3 shrink-0 space-y-2.5 md:space-y-2">
        {/* Subtotal */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Tạm tính</span>
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
            <span className="text-xs text-orange-600">Giảm giá</span>
            <span className="text-sm font-medium text-orange-600 tabular-nums">
              -{formatCurrency(orderDiscountAmount)}
            </span>
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between border-t pt-1.5">
          <span className="text-sm font-semibold text-gray-800">Khách cần trả</span>
          <span className="text-lg font-bold text-primary tabular-nums">
            {formatCurrency(total)}
          </span>
        </div>

        {!isEmpty && (
          <div className="flex gap-2">
            {onPrintPreBill && (
              <Button
                variant="outline"
                onClick={onPrintPreBill}
                className="flex-1 h-8 text-xs"
              >
                <Icon name="description" size={14} className="mr-1" />
                In tạm tính
              </Button>
            )}
            {onSplitBill && activeTab?.kitchenOrderId && lines.length > 1 && (
              <Button
                variant="outline"
                onClick={onSplitBill}
                className="flex-1 h-8 text-xs"
              >
                <Icon name="content_cut" size={14} className="mr-1" />
                Tách bill
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={onSendToKitchen}
            disabled={isEmpty}
            className={cn(
              "flex-1 h-12 text-sm font-semibold",
              "bg-primary hover:bg-primary/90 text-white"
            )}
          >
            <span className="flex flex-col items-center leading-tight">
              <span>Thông báo bếp</span>
              <span className="text-[10px] font-normal opacity-75">F10</span>
            </span>
          </Button>
          <Button
            onClick={onPayment}
            disabled={isEmpty}
            className={cn(
              "flex-1 h-12 text-sm font-semibold",
              "bg-green-600 hover:bg-green-700 text-white"
            )}
          >
            <span className="flex flex-col items-center leading-tight">
              <span>Thanh toán</span>
              <span className="text-[10px] font-normal opacity-75">F9</span>
            </span>
          </Button>
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
  return (
    <div className="px-3 py-2 group">
      <div className="flex items-start justify-between gap-2">
        {/* Name + variant */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-tight">
            {line.productName}
          </p>
          {line.variantLabel && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {line.variantLabel}
            </p>
          )}
        </div>

        {/* Line total */}
        <span className="text-sm font-semibold text-foreground shrink-0">
          {formatCurrency(line.lineTotal)}
        </span>
      </div>

      {/* Toppings */}
      {line.toppings.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {line.toppings.map((t, i) => (
            <p key={i} className="text-[11px] text-muted-foreground pl-2">
              + {t.name} x{t.quantity}{" "}
              <span className="text-muted-foreground">{formatCurrency(t.price)}</span>
            </p>
          ))}
        </div>
      )}
      {line.note && (
        <p className="text-[10px] text-orange-500 mt-0.5 pl-2 italic">{line.note}</p>
      )}
      {/* Qty controls + remove */}
      <div className="flex items-center justify-between mt-2 md:mt-1.5">
        <div className="flex items-center gap-1.5 md:gap-1">
          <button
            type="button"
            onClick={() => onUpdateQty(line.quantity - 1)}
            className="h-9 w-9 md:h-7 md:w-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted transition-colors"
          >
            <Icon name="remove" size={16} className="md:h-3 md:w-3" />
          </button>
          <span className="text-sm font-medium w-7 md:w-6 text-center tabular-nums">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => onUpdateQty(line.quantity + 1)}
            className="h-9 w-9 md:h-7 md:w-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted transition-colors"
          >
            <Icon name="add" size={16} className="md:h-3 md:w-3" />
          </button>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="h-9 w-9 md:h-7 md:w-7 rounded flex items-center justify-center text-red-400 md:text-muted-foreground hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors md:opacity-0 md:group-hover:opacity-100"
          title="Xoá"
        >
          <Icon name="delete" size={16} className="md:h-3.5 md:w-3.5" />
        </button>
      </div>
    </div>
  );
}
