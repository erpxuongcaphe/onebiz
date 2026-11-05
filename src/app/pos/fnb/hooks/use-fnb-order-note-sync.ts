"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FnbOrderNoteConflict, saveFnbOrderNote } from "@/lib/services/supabase/fnb-order-note";
import type { FnbTabSnapshot } from "@/lib/types/fnb";

type SaveStatus = { kind: "saving" | "error"; message?: string; remoteNote?: string; remoteAt?: string };
type Options = {
  scope: string;
  online: boolean;
  tabs: readonly FnbTabSnapshot[];
  acknowledge: (tabId: string, orderId: string, savedNote: string, submittedDraft?: string, savedAt?: string) => void;
  change: (tabId: string, note: string) => void;
};
const pendingKey = (tab: FnbTabSnapshot) => JSON.stringify([tab.kitchenOrderId, tab.orderNoteDraftBase, tab.orderNote]);

export function useFnbOrderNoteSync(options: Options) {
  const { scope, online, tabs } = options;
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; }, [options]);
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const attempted = useRef(new Map<string, string>());
  const flights = useRef(new Map<string, { note: string; promise: Promise<boolean> }>());

  const save = useCallback(async function saveNote(tabId: string, acknowledgedBase?: string): Promise<boolean> {
    const current = latest.current;
    const tab = current.tabs.find(row => row.id === tabId);
    if (!tab?.kitchenOrderId || (tab.orderNoteDraftBase === undefined && acknowledgedBase === undefined)) return true;
    if (!current.online || tab.kitchenOrderId.startsWith("local_")) return false;
    const orderId = tab.kitchenOrderId;
    const scopeAtStart = current.scope;
    const key = `${scopeAtStart}:${tabId}`;
    const flightKey = `${scopeAtStart}:${orderId}`;
    const flight = flights.current.get(flightKey);
    if (flight) {
      if (!await flight.promise || latest.current.scope !== scopeAtStart) return false;
      const next = latest.current.tabs.find(row => row.id === tabId && row.kitchenOrderId === orderId);
      if (!next) return false;
      // Wait for the previous write and compare against its acknowledged value,
      // even if React has not yet committed the corresponding render.
      if ((next.orderNote ?? "") === flight.note) return true;
      return saveNote(tabId, flight.note);
    }
    const note = tab.orderNote ?? "";
    const base = acknowledgedBase ?? tab.orderNoteDraftBase!;
    const version = pendingKey(tab);
    attempted.current.set(key, version);
    setStatuses(prev => ({ ...prev, [key]: { kind: "saving" } }));
    const promise = (async () => {
      try {
        const saved = await saveFnbOrderNote(orderId, note, base);
        if (latest.current.scope !== scopeAtStart) return false;
        latest.current.acknowledge(tabId, orderId, saved.note, note, saved.updatedAt);
        setStatuses(prev => {
          const next = { ...prev }; delete next[key]; return next;
        });
        return true;
      } catch (error) {
        if (latest.current.scope === scopeAtStart) {
          setStatuses(prev => ({ ...prev, [key]: { kind: "error",
            message: error instanceof Error ? error.message : "Chưa lưu được ghi chú. Thử lại.",
            remoteNote: error instanceof FnbOrderNoteConflict ? error.remoteNote : undefined,
            remoteAt: error instanceof FnbOrderNoteConflict ? error.updatedAt : undefined } }));
        }
        return false;
      } finally { flights.current.delete(flightKey); }
    })();
    flights.current.set(flightKey, { note, promise });
    if (!await promise || latest.current.scope !== scopeAtStart) return false;
    const currentTab = latest.current.tabs.find(row => row.id === tabId && row.kitchenOrderId === orderId);
    return !!currentTab && (currentTab.orderNote ?? "") === note;
  }, []);

  const pending = JSON.stringify(tabs.filter(tab => tab.kitchenOrderId && tab.orderNoteDraftBase !== undefined)
    .map(tab => [tab.id, pendingKey(tab)]));
  useEffect(() => { attempted.current.clear(); }, [online, scope]);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        // Restore/reconnect may contain several edited bills. Send sequentially.
        for (const [tabId, version] of JSON.parse(pending) as [string, string][]) {
          if (cancelled || latest.current.scope !== scope) return;
          const key = `${scope}:${tabId}`;
          const tab = latest.current.tabs.find(row => row.id === tabId);
          if (!tab?.kitchenOrderId || tab.kitchenOrderId.startsWith("local_") ||
            pendingKey(tab) !== version || flights.current.has(`${scope}:${tab.kitchenOrderId}`) ||
            attempted.current.get(key) === version) continue;
          await save(tabId);
        }
      })();
    }, 850);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [online, pending, scope, save]);

  const resolve = useCallback((tabId: string, serverNote?: string, keepDraft = false) => {
    const current = latest.current;
    const tab = current.tabs.find(row => row.id === tabId);
    if (!tab?.kitchenOrderId || tab.orderNoteDraftBase === undefined || flights.current.has(`${current.scope}:${tab.kitchenOrderId}`)) return;
    const note = serverNote ?? tab.orderNoteDraftBase;
    if (!keepDraft) current.change(tabId, note);
    const key = `${current.scope}:${tabId}`;
    current.acknowledge(tabId, tab.kitchenOrderId, note, note, statuses[key]?.remoteAt);
    attempted.current.delete(key);
    setStatuses(prev => { const next = { ...prev }; delete next[key]; return next; });
  }, [statuses]);

  return { save, resolve, status: (tabId: string) => statuses[`${scope}:${tabId}`] };
}
