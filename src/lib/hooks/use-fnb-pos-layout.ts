"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EMPTY_FNB_LAYOUT, layoutContent, type FnbPosLayout } from "@/lib/fnb-pos-layout";
import { cacheFnbPosLayout, cachedFnbPosLayout, getFnbPosLayout } from "@/lib/services/supabase/fnb-pos-layout";

/** Refresh presentation only. No cart or catalog replacement on a layout update. */
export function useFnbPosLayout(tenant: string | null | undefined, branch: string | null | undefined, online: boolean) {
  const scope = tenant && branch ? `${tenant}:${branch}` : "";
  const fallback = useMemo(() => tenant && branch ? cachedFnbPosLayout(tenant, branch) : EMPTY_FNB_LAYOUT, [tenant, branch]);
  const [state, setState] = useState({ scope: "", layout: EMPTY_FNB_LAYOUT, error: "" });
  useEffect(() => {
    if (!tenant || !branch) return;
    let active = true, generation = 0;
    const refresh = async () => {
      if (!online || document.visibilityState === "hidden") return;
      const request = ++generation;
      try {
        const layout = await getFnbPosLayout(branch);
        if (!active || request !== generation) return;
        setState(previous => {
          // A slow read begun before this device saved must not undo its newer revision.
          if (previous.scope === scope && previous.layout.revision > layout.revision) return previous;
          if (previous.scope === scope && !previous.error && previous.layout.revision === layout.revision && layoutContent(previous.layout) === layoutContent(layout)) return previous;
          return { scope, layout, error: "" };
        });
      } catch {
        if (active && request === generation) setState(previous => ({ scope,
          layout: previous.scope === scope ? previous.layout : fallback,
          error: "Chưa cập nhật được bố trí. Đang dùng bản đã lưu trên máy.",
        }));
      }
    };
    const storage = (event: StorageEvent) => {
      if (active && event.key === `onebiz:fnb-layout:v1:${tenant}:${branch}`) {
        const layout = cachedFnbPosLayout(tenant, branch);
        setState(previous => previous.scope === scope && previous.layout.revision > layout.revision ? previous : { scope, layout, error: "" });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; generation++; clearInterval(timer); window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", refresh); };
  }, [tenant, branch, scope, online, fallback]);
  useEffect(() => {
    if (tenant && branch && state.scope === scope) cacheFnbPosLayout(tenant, branch, state.layout);
  }, [tenant, branch, scope, state]);
  const accept = useCallback((layout: FnbPosLayout) => {
    if (!tenant || !branch) return;
    cacheFnbPosLayout(tenant, branch, layout);
    setState({ scope, layout, error: "" });
  }, [tenant, branch, scope]);
  return { layout: state.scope === scope ? state.layout : fallback, error: state.scope === scope ? state.error : "", accept };
}
