"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { FnbCartTopping, ModifierSelectionPayload } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";
import type {
  ModifierGroup,
  ModifierOption,
} from "@/lib/services/supabase/modifier-groups";

// ── Types ──

interface Variant { id: string; label: string; sell_price: number }
interface Topping { id: string; name: string; price: number }
interface Product { id: string; name: string; sell_price: number }

/**
 * CEO 01/06/2026 — Sprint 2.2e:
 * Dynamic modifier groups load từ DB (Mức đường, Mức đá, Topping, Size...).
 * Backward compat: nếu không có dynamic groups → fallback hardcoded R7
 * (SWEETNESS_OPTIONS + ICE_OPTIONS) để cashier không bị mất UX cũ.
 */
export interface DynamicModifierData {
  groups: ModifierGroup[];
  /** Map<groupId, options[]> — preload toàn bộ options của các groups */
  optionsByGroup: Map<string, ModifierOption[]>;
}

export interface FnbItemConfirmPayload {
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  unitPrice: number;
  toppings: FnbCartTopping[];
  /**
   * CEO 01/06/2026 — Sprint 2.3a: snapshot dynamic modifier choices.
   * Optional — chỉ có khi SP đang dùng dynamic modifier groups.
   */
  modifierSelections?: ModifierSelectionPayload[];
  note?: string;
}

/**
 * Phase 1A.2: payload pre-fill khi cashier bấm "Sửa" trên 1 dòng giỏ.
 * Dialog sẽ tự parse `note` để khôi phục mức đường/đá vào pill, phần
 * còn lại đẩy vào textarea ghi chú tự do.
 */
export interface FnbItemInitialSelection {
  variantId?: string;
  quantity?: number;
  toppings?: Array<{ id: string; quantity: number }>;
  note?: string;
  /** Sprint 2.3a: prefill dynamic modifier choices khi sửa line cũ. */
  modifierSelections?: ModifierSelectionPayload[];
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
  /**
   * Phase 1A.2: nếu set → mở dialog ở chế độ "Sửa" với giá trị pre-fill.
   * Undefined → chế độ thêm mới (defaults).
   */
  initialSelection?: FnbItemInitialSelection;
  /** Phase 1A.2: nhãn nút confirm. Default "Thêm vào đơn". */
  confirmLabel?: string;
  /**
   * CEO 01/06/2026 — Sprint 2.2e: dynamic modifier groups + options.
   * Nếu có → ẩn hardcoded sweetness/ice, render dynamic.
   * Nếu không → giữ hardcoded fallback.
   */
  dynamicModifiers?: DynamicModifierData;
}

// ── Component ──

// R7: Modifier preset cho cà phê — sweetness + ice level. Build vào note
// để bếp đọc nhanh thay vì khách "viết tay". Mặc định "Bình thường" cho cả 2.
const SWEETNESS_OPTIONS = ["Không đường", "30%", "50%", "70%", "100%"] as const;
const ICE_OPTIONS = ["Không đá", "Ít đá", "Vừa đá", "Nhiều đá"] as const;

/**
 * Phase 1A.2: parse composed note ngược lại sweetness/ice/free.
 * Format khi confirm: `${ice}, ${sweet} đường — ${free}` (mỗi phần optional).
 * Nếu không match modifier nào → trả nguyên note làm free-text.
 */
function parseStoredNote(note: string): { ice: string; sweet: string; free: string } {
  if (!note) return { ice: "", sweet: "", free: "" };
  const dashIdx = note.indexOf(" — ");
  const modPart = dashIdx >= 0 ? note.slice(0, dashIdx) : note;
  const freePart = dashIdx >= 0 ? note.slice(dashIdx + 3).trim() : "";

  let ice = "";
  let sweet = "";
  const remaining: string[] = [];
  const tokens = modPart.split(",").map((s) => s.trim()).filter(Boolean);
  for (const tok of tokens) {
    if ((ICE_OPTIONS as readonly string[]).includes(tok)) {
      ice = tok;
    } else if (tok.endsWith(" đường")) {
      const sw = tok.slice(0, -" đường".length).trim();
      if ((SWEETNESS_OPTIONS as readonly string[]).includes(sw)) {
        sweet = sw;
      } else {
        remaining.push(tok);
      }
    } else {
      remaining.push(tok);
    }
  }
  // Không nhận diện được modifier nào → coi toàn bộ là free-text.
  if (!ice && !sweet) {
    return { ice: "", sweet: "", free: note };
  }
  const free = [remaining.join(", "), freePart].filter(Boolean).join(" — ");
  return { ice, sweet, free };
}

export function FnbItemDialog({
  open, onOpenChange, product, variants, variantsLoading, toppings, onConfirm,
  initialSelection, confirmLabel, dynamicModifiers,
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

  // CEO 01/06/2026 — Sprint 2.2e: Dynamic modifier choices.
  // Map<groupId, Set<optionId>> — multi rule cho nhiều options, single rule
  // sẽ tự kiểm tra trước khi add (clear set rồi add option mới).
  const [dynamicChoices, setDynamicChoices] = useState<Map<string, Set<string>>>(
    new Map(),
  );

  const hasDynamicModifiers =
    dynamicModifiers && dynamicModifiers.groups.length > 0;

  useEffect(() => {
    if (open) {
      // Phase 1A.2: pre-fill từ initialSelection (chế độ Sửa). Nếu undefined
      // thì rơi về defaults (chế độ thêm mới — y nguyên hành vi cũ).
      let initVariant: Variant | null = null;
      if (initialSelection?.variantId) {
        initVariant = variants?.find((v) => v.id === initialSelection.variantId) ?? null;
      }
      if (!initVariant) initVariant = variants?.[0] ?? null;
      setSelectedVariant(initVariant);

      setQuantity(Math.max(1, initialSelection?.quantity ?? 1));

      if (initialSelection?.toppings && initialSelection.toppings.length > 0) {
        const m = new Map<string, number>();
        for (const t of initialSelection.toppings) {
          if (t.quantity > 0) m.set(t.id, Math.min(t.quantity, 10));
        }
        setToppingQtys(m);
      } else {
        setToppingQtys(new Map());
      }

      const parsed = parseStoredNote(initialSelection?.note ?? "");
      setNote(parsed.free);
      setSweetness(parsed.sweet);
      setIceLevel(parsed.ice);

      // CEO 01/06/2026 — Sprint 2.2e + 2.3a: reset dynamic choices.
      // Ưu tiên prefill từ initialSelection.modifierSelections (chế độ Sửa),
      // fallback default options của mỗi group (chế độ Thêm mới).
      if (dynamicModifiers && dynamicModifiers.groups.length > 0) {
        const initChoices = new Map<string, Set<string>>();
        const savedByGroup = new Map<string, Set<string>>();
        if (initialSelection?.modifierSelections) {
          for (const sel of initialSelection.modifierSelections) {
            savedByGroup.set(
              sel.groupId,
              new Set(sel.options.map((o) => o.optionId)),
            );
          }
        }
        for (const g of dynamicModifiers.groups) {
          const saved = savedByGroup.get(g.id);
          if (saved && saved.size > 0) {
            initChoices.set(g.id, saved);
            continue;
          }
          // No saved → use defaults (only for "add new" mode)
          if (!initialSelection?.modifierSelections) {
            const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
            const defaults = opts.filter((o) => o.isDefault).map((o) => o.id);
            if (defaults.length > 0) {
              initChoices.set(g.id, new Set(defaults));
            }
          }
        }
        setDynamicChoices(initChoices);
      } else {
        setDynamicChoices(new Map());
      }
    }
  }, [open, variants, initialSelection, dynamicModifiers]);

  // CEO 01/06/2026 — Sprint 2.2e: toggle 1 option theo rule của group.
  function toggleDynamicChoice(
    group: ModifierGroup,
    optionId: string,
  ) {
    setDynamicChoices((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(group.id) ?? []);
      if (current.has(optionId)) {
        // Click lại → toggle off (trừ khi single_required + đang chỉ có 1)
        if (group.rule === "single_required" && current.size === 1) {
          return prev; // không cho bỏ chọn nếu bắt buộc
        }
        current.delete(optionId);
      } else {
        // Single rule → clear hết, add 1 cái mới
        if (group.rule === "single" || group.rule === "single_required") {
          current.clear();
        }
        current.add(optionId);
      }
      if (current.size === 0) next.delete(group.id);
      else next.set(group.id, current);
      return next;
    });
  }

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

  // CEO 01/06/2026 — Sprint 2.2e: cộng dồn phí từ dynamic modifier options.
  // Vd Trân châu +7k, Size L +5k được include vào unit price.
  const dynamicModifierExtra = useMemo(() => {
    if (!dynamicModifiers) return 0;
    let total = 0;
    for (const [groupId, optionIds] of dynamicChoices.entries()) {
      const opts = dynamicModifiers.optionsByGroup.get(groupId) ?? [];
      for (const optId of optionIds) {
        const opt = opts.find((o) => o.id === optId);
        if (opt) total += opt.priceDelta;
      }
    }
    return total;
  }, [dynamicChoices, dynamicModifiers]);

  const lineTotal = (unitPrice + toppingTotal + dynamicModifierExtra) * quantity;

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

    // CEO 01/06/2026 — Sprint 2.2e: dynamic choices ghi đè hardcoded sweetness/ice.
    if (hasDynamicModifiers && dynamicModifiers) {
      for (const g of dynamicModifiers.groups) {
        const choices = dynamicChoices.get(g.id);
        if (!choices || choices.size === 0) continue;
        const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
        const labels = opts
          .filter((o) => choices.has(o.id))
          .map((o) => o.label);
        if (labels.length > 0) {
          modifierTags.push(`${g.name}: ${labels.join("/")}`);
        }
      }
    } else {
      // Backward compat: hardcoded R7
      if (iceLevel) modifierTags.push(iceLevel);
      if (sweetness) modifierTags.push(sweetness + " đường");
    }

    const trimmedNote = note.trim();
    const composedNote = [
      modifierTags.join(", "),
      trimmedNote,
    ]
      .filter(Boolean)
      .join(" — ");

    // CEO 01/06/2026 — Sprint 2.3a: build modifierSelections snapshot từ
    // dynamicChoices. RPC checkout (Sprint 2.3b) sẽ đọc snapshot này để
    // scale BOM ingredient + trừ tồn topping NVL.
    let modifierSelections: ModifierSelectionPayload[] | undefined;
    if (hasDynamicModifiers && dynamicModifiers) {
      const payload: ModifierSelectionPayload[] = [];
      for (const g of dynamicModifiers.groups) {
        const choices = dynamicChoices.get(g.id);
        if (!choices || choices.size === 0) continue;
        const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
        const selectedOpts = opts.filter((o) => choices.has(o.id));
        if (selectedOpts.length === 0) continue;
        payload.push({
          groupId: g.id,
          groupName: g.name,
          rule: g.rule,
          options: selectedOpts.map((o) => ({
            optionId: o.id,
            label: o.label,
            scaleFactor: o.scaleFactor,
            priceDelta: o.priceDelta,
            linkedProductId: o.linkedProductId,
          })),
        });
      }
      if (payload.length > 0) modifierSelections = payload;
    }

    onConfirm({
      productId: product.id, productName: product.name,
      variantId: selectedVariant?.id, variantLabel: selectedVariant?.label,
      quantity,
      // Sprint 2.2e: unit price include dynamic modifier extras để cashier
      // thấy đúng giá đã chọn (vd Trân châu +7k).
      unitPrice: unitPrice + dynamicModifierExtra,
      toppings: cartToppings,
      modifierSelections,
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
                      "rounded-lg border px-4 py-3 sm:px-3 sm:py-2 text-sm transition-colors active:scale-95",
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
              <div className="grid gap-2 sm:gap-2">
                {toppings.map((t) => {
                  const qty = toppingQtys.get(t.id) ?? 0;
                  const active = qty > 0;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-3 sm:py-2 text-sm transition-colors",
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

          {/* CEO 01/06/2026 — Sprint 2.2e: Dynamic modifier groups từ DB.
              Nếu SP có gán nhóm tuỳ chọn (qua category hoặc override) → render
              ở đây. KHÔNG hiển thị hardcoded R7 nữa khi có dynamic. */}
          {hasDynamicModifiers && dynamicModifiers && (
            <>
              {dynamicModifiers.groups.map((g) => {
                const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
                if (opts.length === 0) return null;
                const choices = dynamicChoices.get(g.id) ?? new Set();
                const ruleLabel =
                  g.rule === "single_required"
                    ? "Bắt buộc chọn 1"
                    : g.rule === "single"
                      ? "Chọn 1"
                      : "Chọn nhiều";
                return (
                  <div key={g.id} className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      {g.name}
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-normal",
                          g.rule === "single_required"
                            ? "bg-status-error/10 text-status-error"
                            : g.rule === "multi"
                              ? "bg-status-success/10 text-status-success"
                              : "bg-status-info/10 text-status-info",
                        )}
                      >
                        {ruleLabel}
                      </span>
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {opts.map((o) => {
                        const active = choices.has(o.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => toggleDynamicChoice(g, o.id)}
                            className={cn(
                              "px-3 py-2 rounded-full border text-xs font-medium transition-colors",
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:border-primary/40",
                            )}
                          >
                            {o.label}
                            {o.priceDelta > 0 && (
                              <span className={cn("ml-1", active ? "" : "text-status-success")}>
                                +{formatCurrency(o.priceDelta)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* R7: Modifier preset (FALLBACK khi chưa setup dynamic modifier) */}
          {!hasDynamicModifiers && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Mức đường</Label>
                <div className="flex flex-wrap gap-2">
                  {SWEETNESS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSweetness(sweetness === s ? "" : s)}
                      className={cn(
                        "px-3 py-2 rounded-full border text-xs font-medium transition-colors",
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
                <div className="flex flex-wrap gap-2">
                  {ICE_OPTIONS.map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setIceLevel(iceLevel === i ? "" : i)}
                      className={cn(
                        "px-3 py-2 rounded-full border text-xs font-medium transition-colors",
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
            </>
          )}

          {/* Note tự do — chỉ dùng khi modifier preset không cover */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Icon name="sticky_note_2" size={14} /> Ghi chú thêm
            </Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="VD: không cay, ấm nóng, ăn riêng..." rows={2} className="resize-none text-sm" />
          </div>
        </div>

        <DialogFooter>
          <Button className="w-full" onClick={handleConfirm}>
            {confirmLabel ?? "Thêm vào đơn"} — {formatCurrency(lineTotal)}đ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
