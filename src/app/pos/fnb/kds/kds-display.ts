import type { KitchenOrderItem } from "@/lib/types/fnb";

export type KdsItemSort = "entry" | "name";
export type KdsModifierLayout = "inline" | "stacked";

export interface KdsDisplayPreferences {
  combineIdenticalItems: boolean;
  itemSort: KdsItemSort;
  modifierLayout: KdsModifierLayout;
  showOrderType: boolean;
  showPaymentStatus: boolean;
  showItemNotes: boolean;
}

export const DEFAULT_KDS_DISPLAY_PREFERENCES: KdsDisplayPreferences = {
  combineIdenticalItems: false,
  itemSort: "entry",
  modifierLayout: "inline",
  showOrderType: true,
  showPaymentStatus: true,
  showItemNotes: true,
};

export interface KdsItemGroup {
  key: string;
  representative: KitchenOrderItem;
  items: KitchenOrderItem[];
  quantity: number;
}

/**
 * Chỉ gom khi mọi thông tin bếp cần làm giống nhau. Giá không tham gia vì KDS
 * không hiển thị giá; trạng thái có tham gia để món đã xong không nhập chung
 * với món đang pha.
 */
export function getKdsItemIdentity(item: KitchenOrderItem): string {
  return JSON.stringify({
    productId: item.productId,
    productName: item.productName,
    variantId: item.variantId,
    variantLabel: item.variantLabel,
    note: item.note,
    toppings: item.toppings,
    modifierSelections: item.modifierSelections ?? [],
    status: item.status,
    kitchenStationId: item.kitchenStationId ?? null,
  });
}

export function prepareKdsItemGroups(
  items: KitchenOrderItem[],
  preferences: Pick<KdsDisplayPreferences, "combineIdenticalItems" | "itemSort">,
): KdsItemGroup[] {
  const groups: KdsItemGroup[] = [];
  const groupIndexes = new Map<string, number>();

  for (const item of items) {
    const identity = getKdsItemIdentity(item);
    const existingIndex = preferences.combineIdenticalItems
      ? groupIndexes.get(identity)
      : undefined;

    if (existingIndex !== undefined) {
      const group = groups[existingIndex];
      group.items.push(item);
      group.quantity += item.quantity;
      continue;
    }

    if (preferences.combineIdenticalItems) groupIndexes.set(identity, groups.length);
    groups.push({
      key: preferences.combineIdenticalItems ? identity : item.id,
      representative: item,
      items: [item],
      quantity: item.quantity,
    });
  }

  if (preferences.itemSort === "name") {
    return groups
      .map((group, index) => ({ group, index }))
      .sort(
        (left, right) =>
          left.group.representative.productName.localeCompare(
            right.group.representative.productName,
            "vi",
            { sensitivity: "base" },
          ) || left.index - right.index,
      )
      .map(({ group }) => group);
  }

  return groups;
}
