"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const checks = new Map<symbol, () => boolean>();
export function hasUnsavedWork() {
  return Array.from(checks.values()).some(check => check());
}
export function requestPageLeave(finish: () => void | Promise<unknown>) {
  if (!hasUnsavedWork()) { finish(); return; }
  const event = new CustomEvent("onebiz:request-page-leave", { detail: finish, cancelable: true });
  if (window.dispatchEvent(event) && window.confirm("Có nội dung chưa lưu. Bỏ thay đổi và rời trang?")) finish();
}

/** Only reads UI state. Never saves, deletes, or persists business data. */
export function useUnsavedWork(check: boolean | (() => boolean)) {
  const latest = useRef(check);
  useLayoutEffect(() => { latest.current = check; }, [check]);
  useEffect(() => {
    const token = Symbol("unsaved-work");
    checks.set(token, () => typeof latest.current === "function" ? latest.current() : latest.current);
    return () => { checks.delete(token); };
  }, []);
}

/** Compare with the exact successfully saved payload, not with today's defaults. */
export function useUnsavedSnapshot<T>(value: T, ready = true, scope = "page") {
  const serialized = JSON.stringify(value);
  const current = useRef({ serialized, ready });
  useLayoutEffect(() => { current.current = { serialized, ready }; }, [serialized, ready]);
  const baseline = useRef<{ scope: string; value: string } | null>(null);
  useEffect(() => {
    if (!ready) { baseline.current = null; return; }
    if (ready && (!baseline.current || baseline.current.scope !== scope)) {
      baseline.current = { scope, value: current.current.serialized };
    }
  }, [ready, scope]);
  useUnsavedWork(() => !!current.current.ready && baseline.current?.scope === scope && baseline.current.value !== current.current.serialized);
  return useCallback((saved: T) => {
    baseline.current = { scope, value: JSON.stringify(saved) };
  }, [scope]);
}
