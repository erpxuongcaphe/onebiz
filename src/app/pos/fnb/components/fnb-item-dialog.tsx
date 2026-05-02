"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { FnbCartTopping } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";

// ── Types ──

interface Variant { id: string; label: string; sell_price: number }
interface Topping { id: string; name: string; price: number }
interface Product { id: string; name: string; sell_price: number }

export interface FnbItemConfirmPayload {
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  unitPrice: number;
  toppings: FnbCartTopping[];
  note?: string;
}

interface FnbItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  variants?: Variant[];
  /** True khi đang fetch variants (cache miss). Hiện skeleton thay vì empty. */
  variantsLoading?: boolean;
  toppings?: Topping[];
  onConfirm: (payload: FnbItemConfirmPayload) => void;
}

// ── Component ──

export function FnbItemDialog({
  open, onOpenChange, product, variants, variantsLoading, toppings, onConfirm,
}: FnbItemDialogProps) {
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedToppings, setSelectedToppings] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedVariant(variants?.[0] ?? null);
      setQuantity(1);
      setSelectedToppings(new Set());
      setNote("");
    }
  }, [open, variants]);

  const toggleTopping = useCallback((id: string) => {
    setSelectedToppings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const unitPrice = selectedVariant?.sell_price ?? product?.sell_price ?? 0;
  const toppingTotal = useMemo(() => {
    if (!toppings) return 0;
    return toppings.filter((t) => selectedToppings.has(t.id)).reduce((s, t) => s + t.price, 0);
  }, [toppings, selectedToppings]);
  const lineTotal = (unitPrice + toppingTotal) * quantity;

  const handleConfirm = () => {
    if (!product) return;
    const cartToppings: FnbCartTopping[] = (toppings ?? [])
      .filter((t) => selectedToppings.has(t.id))
      .map((t) => ({ productId: t.id, name: t.name, quantity: 1, price: t.price }));
    onConfirm({
      productId: product.id, productName: product.name,
      variantId: selectedVariant?.id, variantLabel: selectedVariant?.label,
      quantity, unitPrice, toppings: cartToppings,
      note: note.trim() || undefined,
    });
    onOpenChange(false);
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">{product.name}</DialogTitle>
          <DialogDescription>Giá: {formatCurrency(product.sell_price)}đ</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Size / Variant selector. POS-FIX-C3: skeleton khi đang fetch
              variants (cache miss) — tránh user thấy "không có size" rồi
              tưởng món không có biến thể, click thêm với giá gốc. */}
          {variantsLoading && (!variants || variants.length === 0) ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Kích cỡ</Label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-10 sm:h-8 w-20 rounded-lg bg-muted animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : variants && variants.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Kích cỡ</Label>
              <div className="flex flex-wrap gap-2">
                {variants.map((v) => (
                  <button key={v.id} type="button" onClick={() => setSelectedVariant(v)}
                    className={cn(
                      "rounded-lg border px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm transition-colors active:scale-95",
                      selectedVariant?.id === v.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50",
                    )}>
                    {v.label} {formatCurrency(v.sell_price)}đ
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Quantity */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Số lượng</Label>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" className="h-10 w-10 sm:h-8 sm:w-8"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                <Icon name="remove" size={16} />
              </Button>
              <span className="w-10 text-center text-lg sm:text-base font-semibold tabular-nums">{quantity}</span>
              <Button variant="outline" size="icon" className="h-10 w-10 sm:h-8 sm:w-8"
                onClick={() => setQuantity((q) => q + 1)}>
                <Icon name="add" size={16} />
              </Button>
            </div>
          </div>

          {/* Toppings */}
          {toppings && toppings.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Topping</Label>
              <div className="grid gap-2 sm:gap-1.5">
                {toppings.map((t) => (
                  <label key={t.id} className={cn(
                    "flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 sm:px-3 sm:py-2 text-sm transition-colors active:bg-muted",
                    selectedToppings.has(t.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/30",
                  )}>
                    <div className="flex items-center gap-2.5 sm:gap-2">
                      <input type="checkbox" className="accent-primary h-5 w-5 sm:h-4 sm:w-4"
                        checked={selectedToppings.has(t.id)} onChange={() => toggleTopping(t.id)} />
                      <span>{t.name}</span>
                    </div>
                    <Badge variant="secondary">+{formatCurrency(t.price)}đ</Badge>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Note */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Icon name="sticky_note_2" size={14} /> Ghi chú
            </Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú: ít đá, 70% đường..." rows={2} className="resize-none text-sm" />
          </div>
        </div>

        <DialogFooter>
          <Button className="w-full" onClick={handleConfirm}>
            Thêm vào đơn — {formatCurrency(lineTotal)}đ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
