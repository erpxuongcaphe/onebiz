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

// R7: Modifier preset cho cà phê — sweetness + ice level. Build vào note
// để bếp đọc nhanh thay vì khách "viết tay". Mặc định "Bình thường" cho cả 2.
const SWEETNESS_OPTIONS = ["Không đường", "30%", "50%", "70%", "100%"] as const;
const ICE_OPTIONS = ["Không đá", "Ít đá", "Vừa đá", "Nhiều đá"] as const;

export function FnbItemDialog({
  open, onOpenChange, product, variants, variantsLoading, toppings, onConfirm,
}: FnbItemDialogProps) {
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [quantity, setQuantity] = useState(1);
  // R6: Topping qty stepper — Map<id, qty> thay vì Set<id> chỉ check/uncheck.
  // Khách quen "thêm 2 trân châu" giờ tap stepper +/- thay vì add 2 line riêng.
  const [toppingQtys, setToppingQtys] = useState<Map<string, number>>(new Map());
  const [note, setNote] = useState("");
  // R7: Modifier preset (sweetness + ice). Empty = không nói gì (mặc định pha bình thường).
  const [sweetness, setSweetness] = useState<string>("");
  const [iceLevel, setIceLevel] = useState<string>("");

  useEffect(() => {
    if (open) {
      setSelectedVariant(variants?.[0] ?? null);
      setQuantity(1);
      setToppingQtys(new Map());
      setNote("");
      setSweetness("");
      setIceLevel("");
    }
  }, [open, variants]);

  const setToppingQty = useCallback((id: string, qty: number) => {
    setToppingQtys((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, Math.min(qty, 10)); // cap 10/topping/line tránh nhập sai
      return next;
    });
  }, []);

  const unitPrice = selectedVariant?.sell_price ?? product?.sell_price ?? 0;
  const toppingTotal = useMemo(() => {
    if (!toppings) return 0;
    return toppings.reduce((s, t) => {
      const q = toppingQtys.get(t.id) ?? 0;
      return s + t.price * q;
    }, 0);
  }, [toppings, toppingQtys]);
  const lineTotal = (unitPrice + toppingTotal) * quantity;

  const handleConfirm = () => {
    if (!product) return;
    const cartToppings: FnbCartTopping[] = (toppings ?? [])
      .filter((t) => (toppingQtys.get(t.id) ?? 0) > 0)
      .map((t) => ({
        productId: t.id,
        name: t.name,
        quantity: toppingQtys.get(t.id) ?? 1,
        price: t.price,
      }));

    // Build composite note: modifier presets + free-text. Bếp đọc 1 dòng:
    // vd "Ít đá, 70% đường — không cay nhé"
    const modifierTags: string[] = [];
    if (iceLevel) modifierTags.push(iceLevel);
    if (sweetness) modifierTags.push(sweetness + " đường");
    const trimmedNote = note.trim();
    const composedNote = [
      modifierTags.join(", "),
      trimmedNote,
    ]
      .filter(Boolean)
      .join(" — ");

    onConfirm({
      productId: product.id, productName: product.name,
      variantId: selectedVariant?.id, variantLabel: selectedVariant?.label,
      quantity, unitPrice, toppings: cartToppings,
      note: composedNote || undefined,
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
                {toppings.map((t) => {
                  const qty = toppingQtys.get(t.id) ?? 0;
                  const active = qty > 0;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-2.5 sm:py-2 text-sm transition-colors",
                        active ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground">{t.name}</div>
                        <Badge variant="secondary" className="mt-0.5">
                          +{formatCurrency(t.price)}đ
                        </Badge>
                      </div>
                      {/* R6: Stepper +/- qty thay vì checkbox */}
                      <div className="flex items-center gap-0.5 bg-surface-container-lowest rounded-full p-0.5 border border-outline-variant/15 ml-2">
                        <button
                          type="button"
                          onClick={() => setToppingQty(t.id, qty - 1)}
                          disabled={qty === 0}
                          className="size-9 sm:size-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-high hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Bớt topping"
                        >
                          <Icon name="remove" size={16} />
                        </button>
                        <span className="w-7 text-center text-sm font-semibold tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setToppingQty(t.id, qty + 1)}
                          className="size-9 sm:size-8 rounded-full flex items-center justify-center text-primary hover:bg-primary-fixed"
                          aria-label="Thêm topping"
                        >
                          <Icon name="add" size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* R7: Modifier preset — Đường + Đá. Tap pill thay vì gõ note tay. */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mức đường</Label>
            <div className="flex flex-wrap gap-1.5">
              {SWEETNESS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSweetness(sweetness === s ? "" : s)}
                  className={cn(
                    "px-3 py-1.5 rounded-full border text-xs font-medium transition-colors",
                    sweetness === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Mức đá</Label>
            <div className="flex flex-wrap gap-1.5">
              {ICE_OPTIONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIceLevel(iceLevel === i ? "" : i)}
                  className={cn(
                    "px-3 py-1.5 rounded-full border text-xs font-medium transition-colors",
                    iceLevel === i
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* Note tự do — chỉ dùng khi modifier preset không cover */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Icon name="sticky_note_2" size={14} /> Ghi chú thêm
            </Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="VD: không cay, ấm nóng, ăn riêng..." rows={2} className="resize-none text-sm" />
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
