import type { FnbDiscountInput, FnbOrderLine } from "@/lib/types/fnb";

/** The amount input is the total reduction across selected rows, including toppings. */
export function fnbManualDiscountAmount(lines: FnbOrderLine[], discount: FnbDiscountInput | undefined, persisted = 0): number {
  if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return 0;
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const selected = discount.lineIds === undefined ? lines : lines.filter(line => discount.lineIds!.includes(line.id));
  const base = Math.max(0, Math.min(selected.reduce((sum, line) => sum + line.lineTotal, 0), subtotal - persisted));
  return discount.mode === "percent" ? Math.round(base * Math.min(discount.value, 100) / 100) : Math.min(Math.round(discount.value), base);
}

export function fnbDiscountCartKey(lines: FnbOrderLine[], persisted = 0): string {
  return JSON.stringify({ persisted, lines: lines.map(line => ({ id: line.id, productId: line.productId, variantId: line.variantId ?? null,
    quantity: line.quantity, unitPrice: line.unitPrice, toppings: line.toppings, modifierSelections: line.modifierSelections ?? [], note: line.note ?? "" })).sort((a,b) => a.id.localeCompare(b.id)) });
}
