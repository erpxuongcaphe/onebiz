"use client";

import { useCallback, useRef, useState } from "react";

export const FNB_BUYER_POPUP_TRACE = "onebiz:fnb-buyer-popup:v1";
type OpenSource = "customer-button" | "shortcut" | "send-kitchen" | "payment" | "payment-customer";
type TraceEntry = { at: string; action: "open" | "close" | "shortcut-ignored"; source: string };

/** Device-local diagnostics only: no customer, bill, auth or network data. */
function trace(action: TraceEntry["action"], source: string) {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(FNB_BUYER_POPUP_TRACE) ?? "[]");
    const entries = Array.isArray(parsed) ? parsed.slice(-39).filter(entry =>
      entry && typeof entry.at === "string" && typeof entry.action === "string" && typeof entry.source === "string",
    ).map(({ at, action, source }) => ({ at, action, source })) : [];
    sessionStorage.setItem(FNB_BUYER_POPUP_TRACE, JSON.stringify([...entries, { at: new Date().toISOString(), action, source }]));
  } catch { /* Storage restrictions must never block the cashier. */ }
}

export function customerShortcutBlockedReason(event: Pick<KeyboardEvent,
  "isTrusted" | "repeat" | "defaultPrevented" | "isComposing" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>, modalOpen: boolean, hidden: boolean): string | null {
  if (!event.isTrusted) return "synthetic";
  if (event.repeat) return "repeat";
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return "modified";
  if (event.defaultPrevented || event.isComposing) return "consumed";
  if (hidden) return "hidden";
  if (modalOpen) return "modal-open";
  return null;
}

/** Never opens from timers, data refreshes or restored bill state. */
export function useFnbCustomerPicker() {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const openPicker = useCallback((source: OpenSource) => {
    if (openRef.current) return;
    openRef.current = true;
    trace("open", source);
    setOpen(true);
  }, []);
  const closePicker = useCallback((source: "dismiss" | "selected" = "dismiss") => {
    if (!openRef.current) return;
    openRef.current = false;
    trace("close", source);
    setOpen(false);
  }, []);
  const handleShortcut = useCallback((event: KeyboardEvent) => {
    if (event.key !== "F4") return false;
    const modalOpen = openRef.current || !!document.querySelector('[role="dialog"], [role="alertdialog"]');
    const blocked = customerShortcutBlockedReason(event, modalOpen, document.hidden);
    // Preserve native Alt+F4/Ctrl+F4; do not turn closing a window/tab into
    // choosing a buyer. Held F4 must not reopen the picker after clicking X.
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) event.preventDefault();
    if (blocked) {
      if (!event.repeat) trace("shortcut-ignored", blocked);
      return true;
    }
    openPicker("shortcut");
    return true;
  }, [openPicker]);
  return { open, openPicker, closePicker, handleShortcut };
}
