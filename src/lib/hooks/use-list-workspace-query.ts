"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Result<T> {
  scope: string;
  load: () => Promise<T>;
  data: T | null;
  error: string | null;
  loading: boolean;
  fetching: boolean;
}

/** The memoized loader identifies the complete filter/account scope. */
export function useListWorkspaceQuery<T>(load: () => Promise<T>, enabled = true, scope = "") {
  const [result, setResult] = useState<Result<T> | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const id = ++request.current;
    if (!enabled) return;
    setResult(previous => {
      const data = background && previous?.load === load && previous.scope === scope ? previous.data : null;
      return { scope, load, error: null, loading: data === null, fetching: true, data };
    });
    try {
      const data = await load();
      if (request.current === id) setResult({ scope, load, data, error: null, loading: false, fetching: false });
    } catch (error) {
      if (request.current === id) setResult({ scope, load, data: null, loading: false, fetching: false,
        error: error instanceof Error ? error.message : "Không tải được danh sách." });
    }
  }, [enabled, load, scope]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; request.current += 1; };
  }, [refresh]);
  const current = enabled && result?.load === load && result.scope === scope ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: enabled && (current?.loading ?? true),
    fetching: enabled && (current?.fetching ?? true),
    refresh,
  };
}
