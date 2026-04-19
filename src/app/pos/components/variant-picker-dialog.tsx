"use client";

/**
 * VariantPickerDialog — chọn biến thể đóng gói cho Retail POS.
 *
 * Luồng: click sản phẩm trong grid → nếu có biến thể (>1) thì mở dialog này;
 * nếu không có thì thêm trực tiếp vào giỏ. User chọn biến thể + số lượng →
 * dialog trả về thông tin để cashier thêm vào line.
 *
 * Khác với FnB: không có topping, không có note, không có variantId "base".
 */

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
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { Product, ProductVariant } from "@/lib/types";

export interface VariantPickerConfirmPayload {
  variantId: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
}

interface VariantPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  variants: ProductVariant[];
  onConfirm: (payload: VariantPickerConfirmPayload) => void;
}

function formatVariantMeta(v: ProductVariant): string {
  const parts: string[] = [];
  if (v.packagingType) parts.push(v.packagingType);
  if (v.packagingSize) parts.push(v.packagingSize);
  if (v.unitCount && v.unitCount > 1) parts.push(`${v.unitCount} đơn vị`);
  if (v.weight) parts.push(`${v.weight}kg`);
  return parts.join(" · ");
}

export function VariantPickerDialog({
  open,
  onOpenChange,
  product,
  variants,
  onConfirm,
}: VariantPickerDialogProps) {
  const defaultVariant = useMemo(
    () => variants.find((v) => v.isDefault) ?? variants[0],
    [variants]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number>(1);

  useEffect(() => {
    if (open) {
      setSelectedId(defaultVariant?.id ?? null);
      setQuantity(1);
    }
  }, [open, defaultVariant]);

  const selected = useMemo(
    () => variants.find((v) => v.id === selectedId) ?? null,
    [variants, selectedId]
  );

  const lineTotal = (selected?.sellPrice ?? 0) * quantity;

  const handleConfirm = () => {
    if (!selected || quantity <= 0) return;
    onConfirm({
      variantId: selected.id,
      variantLabel: selected.name,
      unitPrice: selected.sellPrice,
      quantity,
    });
    onOpenChange(false);
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="inventory_2" size={18} className="text-primary" />
            {product.name}
          </DialogTitle>
          <DialogDescription>
            Chọn biến thể đóng gói — mỗi biến thể có giá và tồn kho riêng.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Variant list */}
          <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
            {variants.map((v) => {
              const isSelected = v.id === selectedId;
              const meta = formatVariantMeta(v);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary-fixed/40 ring-2 ring-primary/30"
                      : "border-border bg-surface-container-lowest hover:bg-surface-container-low"
                  )}
                >
                  <div
                    className={cn(
                      "size-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-white"
                    )}
                  >
                    {isSelected && <Icon name="check" size={12} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">
                        {v.name}
                      </span>
                      {v.isDefault && (
                        <span className="px-1.5 py-0.5 rounded-full bg-status-info/10 text-status-info text-[10px] font-semibold">
                          Mặc định
                        </span>
                      )}
                    </div>
                    {meta && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {meta}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-primary tabular-nums">
                      {formatCurrency(v.sellPrice)}
                    </div>
                    {v.sku && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {v.sku}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quantity picker */}
          <div className="flex items-center justify-between rounded-xl bg-surface-container-low px-3 py-2.5">
            <span className="text-sm font-medium text-foreground">Số lượng</span>
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-lg"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Icon name="remove" size={14} />
              </Button>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setQuantity(Number.isFinite(v) && v > 0 ? v : 1);
                }}
                className="h-8 w-16 text-center tabular-nums"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-lg"
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Icon name="add" size={14} />
              </Button>
            </div>
          </div>

          {/* Total */}
          {selected && (
            <div className="flex items-center justify-between rounded-xl bg-primary-fixed/30 px-3 py-2.5 border border-primary/20">
              <span className="text-sm font-medium text-foreground">Thành tiền</span>
              <span className="font-heading text-lg font-extrabold text-primary tabular-nums">
                {formatCurrency(lineTotal)}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected || quantity <= 0}
            className="bg-primary text-white"
          >
            <Icon name="add_shopping_cart" size={14} className="mr-1.5" />
            Thêm vào giỏ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
