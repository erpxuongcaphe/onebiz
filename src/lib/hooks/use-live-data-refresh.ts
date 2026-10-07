"use client";
import { useEffect, useState } from "react";
import { getClient } from "@/lib/services/supabase/base";
/** Realtime invalidation plus visible-page polling/reconnect recovery. Queries remain tenant/branch scoped. */
export function useLiveDataRefresh(refresh: () => void | Promise<void>, tenantId: string | undefined, branchId: string | undefined, tables: string[], enabled = true) {
  const [connected, setConnected] = useState(false);
  const tableKey = tables.join(",");
  useEffect(() => {
    if (!enabled || !tenantId) return;
    const client = getClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const run = () => { if (!disposed && !document.hidden) void refresh(); };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
    const channel = client.channel(`live-${tenantId}-${branchId ?? "all"}-${tableKey}`);
    for (const table of tableKey.split(",")) {
      const filter = table === "kitchen_order_items" ? undefined : branchId ? `branch_id=eq.${branchId}` : `tenant_id=eq.${tenantId}`;
      channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, schedule);
    }
    channel.subscribe((status) => { if (disposed) return; setConnected(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") schedule(); });
    const interval = setInterval(run, 30_000);
    window.addEventListener("focus", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("fnb-open-orders-changed", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true; clearTimeout(timer); clearInterval(interval);
      window.removeEventListener("focus", schedule); window.removeEventListener("online", schedule);
      window.removeEventListener("fnb-open-orders-changed", schedule); document.removeEventListener("visibilitychange", schedule);
      void client.removeChannel(channel);
    };
  }, [refresh, tenantId, branchId, tableKey, enabled]);
  return connected && enabled;
}
