"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFnbBranchComponentCosts, type FnbBranchComponentCost } from "@/lib/services/supabase/fnb-branch-cost";

const EMPTY: Record<string, FnbBranchComponentCost> = {};
interface CostScope { enabled: boolean; branchId: string | null | undefined; idsKey: string; attempt: number }

export function useFnbBranchCosts(enabled: boolean, branchId: string | null | undefined, productIds: string[]) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ scope: CostScope | null; costs: Record<string, FnbBranchComponentCost>; error: boolean }>({ scope: null, costs: EMPTY, error: false });
  const idsKey = JSON.stringify([...new Set(productIds.filter(Boolean))].sort());
  const scope = useMemo(() => ({ enabled: enabled && !!branchId && idsKey !== "[]", branchId, idsKey, attempt }), [enabled, branchId, idsKey, attempt]);
  useEffect(() => {
    if (!scope.enabled || !scope.branchId) return;
    const controller = new AbortController();
    getFnbBranchComponentCosts(scope.branchId, JSON.parse(scope.idsKey), controller.signal)
      .then(costs => {
        if (!controller.signal.aborted) setResult({ scope, costs: Object.fromEntries(costs), error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ scope, costs: EMPTY, error: true });
      });
    return () => controller.abort();
  }, [scope]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const current = scope.enabled && result.scope === scope;
  return { costs: current ? result.costs : EMPTY, loading: scope.enabled && !current, error: current && result.error, retry };
}
