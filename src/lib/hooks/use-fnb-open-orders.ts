"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getUnpaidFnbOrders } from "@/lib/services/supabase/kitchen-orders";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
import { useLiveDataRefresh } from "./use-live-data-refresh";
export function useFnbOpenOrders(tenantId: string | undefined, branchId?: string, enabled = true) {
  const scope = `${tenantId ?? ""}:${branchId ?? "all"}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; orders: FnbOpenOrder[]; error: string | null; updatedAt: Date | null }>({ scope, orders: [], error: null, updatedAt: null });
  const refresh = useCallback(async () => {
    if (!enabled || !tenantId) return;
    const request = ++generation.current;
    try {
      const orders = await getUnpaidFnbOrders(branchId);
      if (scopeRef.current !== scope || request !== generation.current) return;
      setSnapshot({ scope, orders, error: null, updatedAt: new Date() });
    } catch (error) {
      if (scopeRef.current !== scope || request !== generation.current) return;
      setSnapshot((previous) => ({ ...previous, scope, orders: previous.scope === scope ? previous.orders : [], updatedAt: previous.scope === scope ? previous.updatedAt : null, error: error instanceof Error ? error.message : "Không tải được đơn đang mở" }));
    }
  }, [enabled, tenantId, branchId, scope]);
  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh]);
  const connected = useLiveDataRefresh(refresh, tenantId, branchId, ["kitchen_orders"], enabled);
  const visible = snapshot.scope === scope && enabled;
  return { orders: visible ? snapshot.orders : [], error: visible ? snapshot.error : null, updatedAt: visible ? snapshot.updatedAt : null, loading: enabled && (!visible || (!snapshot.updatedAt && !snapshot.error)), connected, refresh };
}
