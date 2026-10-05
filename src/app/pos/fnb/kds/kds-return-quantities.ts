import type { KitchenOrderItem } from "@/lib/types/fnb";
import type { KitchenReturnLine } from "@/lib/services/supabase/kitchen-return-summary";

export function projectKitchenReturnItems(
  items: KitchenOrderItem[],
  lines?: ReadonlyMap<string, KitchenReturnLine> | null,
): KitchenOrderItem[] {
  return items.map((item) => {
    const line = lines?.get(item.id);
    if (!line || line.kitchenOrderId !== item.kitchenOrderId
      || !Number.isFinite(line.remainingQuantity) || !Number.isFinite(line.returnedQuantity)) return item;
    return { ...item, quantity: Math.max(0, Math.min(item.quantity, line.remainingQuantity)) };
  });
}

export function getKitchenActionItems(items: KitchenOrderItem[], lines?: ReadonlyMap<string, KitchenReturnLine> | null) {
  return projectKitchenReturnItems(items, lines).filter((item) => item.quantity > 0);
}
