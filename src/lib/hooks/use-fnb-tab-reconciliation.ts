"use client";

import { useEffect } from "react";
import { getKitchenOrderById } from "@/lib/services/supabase/kitchen-orders";
import { isUnpaidFnbOrder, type FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { KitchenOrder } from "@/lib/types/fnb";

export function useFnbTabReconciliation({ tabs, branchId, orders, updatedAt, blocked, onClosed }: {
  tabs: readonly { id: string; kitchenOrderId?: string }[];
  branchId?: string | null;
  orders: FnbOpenOrder[];
  updatedAt: Date | null;
  blocked: boolean;
  onClosed: (order: KitchenOrder, tabId: string) => void;
}) {
  useEffect(() => {
    if (!branchId || !updatedAt || blocked) return;
    const openIds = new Set(orders.map((order) => order.id));
    const candidates = new Map<string, string[]>();
    for (const tab of tabs) {
      const orderId = tab.kitchenOrderId;
      if (!orderId || orderId.startsWith("local_") || openIds.has(orderId)) continue;
      candidates.set(orderId, [...(candidates.get(orderId) ?? []), tab.id]);
    }
    let cancelled = false;
    const queue = [...candidates];
    // Verify all saved tabs, deduplicate shared orders and bound concurrent reads.
    const verifyNext = async () => {
      while (!cancelled && queue.length) {
        const [orderId, tabIds] = queue.shift()!;
        try {
          const order = await getKitchenOrderById(orderId);
          if (cancelled || order.id !== orderId || order.branchId !== branchId || isUnpaidFnbOrder(order)) continue;
          for (const tabId of tabIds) {
            if (!cancelled) onClosed(order, tabId);
          }
        } catch {
          // A missing/failed read cannot prove payment or discard a draft.
        }
      }
    };
    for (let i = 0; i < Math.min(3, candidates.size); i++) void verifyNext();
    return () => { cancelled = true; };
  }, [tabs, branchId, orders, updatedAt, blocked, onClosed]);
}
