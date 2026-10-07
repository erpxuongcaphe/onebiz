"use client";
import { useEffect } from "react";
import { getKitchenOrderById } from "@/lib/services/supabase/kitchen-orders";
import { isUnpaidFnbOrder, type FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { KitchenOrder } from "@/lib/types/fnb";

export function useFnbTabReconciliation({ tabId, orderId, branchId, orders, updatedAt, blocked, onClosed }: {
  tabId?: string; orderId?: string; branchId?: string | null; orders: FnbOpenOrder[];
  updatedAt: Date | null; blocked: boolean; onClosed: (order: KitchenOrder, tabId: string) => void;
}) {
  useEffect(() => {
    if (!tabId || !orderId || !branchId || !updatedAt || blocked || orders.some(order => order.id === orderId)) return;
    let cancelled = false;
    void getKitchenOrderById(orderId).then(order => {
      if (cancelled || order.branchId !== branchId || isUnpaidFnbOrder(order)) return;
      onClosed(order, tabId);
    }).catch(() => { /* A missing/failed read cannot prove payment or discard a draft. */ });
    return () => { cancelled = true; };
  }, [tabId, orderId, branchId, orders, updatedAt, blocked, onClosed]);
}
