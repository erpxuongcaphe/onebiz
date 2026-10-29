"use client";
import { useEffect, useId, useRef, useState } from "react";
import { getClient } from "@/lib/services/supabase/base";
import { createRefreshScheduler } from "@/lib/refresh-scheduler";
/** Realtime invalidation plus visible-page polling/reconnect recovery. Queries remain tenant/branch scoped. */
export function useLiveDataRefresh(refresh: () => void | Promise<void>, tenantId: string | undefined, branchId: string | undefined, tables: string[], enabled = true, pollIntervalMs = 30_000, options: { refreshOnOrderChange?: boolean } = {}) {
  const refreshOnOrderChange = options.refreshOnOrderChange !== false;
  const tableKey = tables.join(",");
  const intervalMs = Number.isFinite(pollIntervalMs) ? Math.max(30_000, pollIntervalMs) : 30_000;
  const instanceId = useId();
  const subscriptionGeneration = useRef(0);
  const scope = `${tenantId}:${branchId}:${tableKey}`;
  const [connection, setConnection] = useState({ scope: "", connected: false });
  useEffect(() => {
    if (!enabled || !tenantId) return;
    const client = getClient();
    let disposed = false;
    const scheduler = createRefreshScheduler(refresh, () => !document.hidden && navigator.onLine !== false);
    const schedule = () => scheduler.request();
    // Supabase reuses channels by topic; every effect needs its own channel.
    const channel = client.channel(`live-${tenantId}-${branchId ?? "all"}-${tableKey}-${instanceId}-${++subscriptionGeneration.current}`);
    for (const table of tableKey.split(",")) {
      const filter = table === "kitchen_order_items" ? undefined : branchId ? `branch_id=eq.${branchId}` : `tenant_id=eq.${tenantId}`;
      channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, schedule);
    }
    channel.subscribe((status) => { if (disposed) return; setConnection({ scope, connected: status === "SUBSCRIBED" }); if (status === "SUBSCRIBED") schedule(); });
    const interval = setInterval(() => scheduler.poll(), intervalMs);
    window.addEventListener("focus", schedule);
    window.addEventListener("online", schedule);
    if (refreshOnOrderChange) window.addEventListener("fnb-open-orders-changed", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true; scheduler.dispose(); clearInterval(interval);
      window.removeEventListener("focus", schedule); window.removeEventListener("online", schedule);
      window.removeEventListener("fnb-open-orders-changed", schedule); document.removeEventListener("visibilitychange", schedule);
      void client.removeChannel(channel);
    };
  }, [refresh, tenantId, branchId, tableKey, enabled, scope, instanceId, intervalMs, refreshOnOrderChange]);
  return connection.scope === scope && connection.connected && enabled;
}
