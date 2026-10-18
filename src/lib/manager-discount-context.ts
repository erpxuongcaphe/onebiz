import type { FnbDiscountInput, FnbOrderLine } from '@/lib/types/fnb';
import type { DiscountInput, OrderLine } from '@/app/pos/hooks/use-pos-state';

export function fnbDiscountContext(branchId: string | undefined, tabId: string, label: string, orderId: string | undefined,
  lines: FnbOrderLine[], subtotal: number, discount: FnbDiscountInput | undefined, persisted = 0) {
  const discountable = Math.max(0, subtotal - persisted);
  const amount = !discount ? 0 : discount.mode === 'percent' ? Math.round(discountable * Math.min(discount.value, 100) / 100) : Math.min(discount.value, discountable);
  return { branch_id: branchId, draft_key: tabId, label, entity_id: orderId ?? null, subtotal, amount, existing_discount: persisted,
    items: lines.map(l => ({ productId: l.productId, productName: l.productName, variantId: l.variantId ?? null,
      quantity: l.quantity, unitPrice: l.unitPrice, toppings: l.toppings.map(t => ({ productId: t.productId, name: t.name, quantity: t.quantity, price: t.price })), modifierSelections: l.modifierSelections ?? [] })) };
}

export function retailDiscountContext(branchId: string | undefined, sessionId: string, lines: OrderLine[],
  orderDiscount: DiscountInput, lineChange?: { id: string; discount: DiscountInput }, internal = false, manualOrder = true, draftId?: string | null) {
  const items = lines.map(l => {
    const d = lineChange?.id === l.lineId ? lineChange.discount : l.discount;
    const gross = internal ? Math.round(l.quantity * l.unitPrice) : l.quantity * l.unitPrice;
    const discount = d.mode === 'percent' ? Math.round(gross * d.value / 100) : Math.max(0, d.value);
    return { productId: l.productId, productName: l.productName, variantId: l.variantId ?? null, quantity: l.quantity,
      unitPrice: l.unitPrice, unit: l.unit, discount };
  });
  const subtotal = items.reduce((s,l) => s + (internal ? Math.round(l.quantity*l.unitPrice) : l.quantity*l.unitPrice),0);
  const lineTotal = items.reduce((s,l) => s+l.discount,0);
  const after = Math.max(0,subtotal-lineTotal);
  const order = !manualOrder ? 0 : orderDiscount.mode === 'percent' ? Math.round(after*orderDiscount.value/100) : Math.max(0,orderDiscount.value);
  return { branch_id: branchId, session_id: sessionId, bill_key: draftId ?? sessionId, label: internal ? 'Đơn bán nội bộ' : 'Đơn POS Retail', subtotal, amount: lineTotal+order, items };
}
