import type { FnbOrderLine, KitchenOrderItem } from "@/lib/types/fnb";

function selections(value: FnbOrderLine["modifierSelections"]) {
  return (value ?? []).map(group => [group.groupId, group.options.map(option => option.optionId).sort().join(",")].join(":" )).sort().join("|");
}
function toppings(value: FnbOrderLine["toppings"]) {
  return (value ?? []).map(item => `${item.productId}:${item.quantity}:${item.price}`).sort().join("|");
}
/** Select by server identity first. Legacy snapshots only match when unambiguous. */
export function findCancellationItem(line: FnbOrderLine | undefined, items: KitchenOrderItem[]): string | undefined {
  if (!line) return undefined;
  if (line.kitchenOrderItemId) return items.find(item => item.id === line.kitchenOrderItemId)?.id;
  const matches = items.filter(item => item.productId === line.productId
    && (item.variantId ?? "") === (line.variantId ?? "")
    && (item.note ?? "") === (line.note ?? "")
    && item.unitPrice === line.unitPrice
    && selections(item.modifierSelections) === selections(line.modifierSelections)
    && toppings(item.toppings) === toppings(line.toppings));
  return matches.length === 1 ? matches[0].id : undefined;
}
