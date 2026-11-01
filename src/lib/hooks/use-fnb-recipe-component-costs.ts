"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Product } from "@/lib/types";
import { getFnbBranchComponentCosts, getPreparedRecipeEstimateUnitCost, type FnbBranchComponentCost } from "@/lib/services/supabase/fnb-branch-cost";
import { getFnbPreparedRecipeEstimateDetails, type FnbMenuEstimate } from "@/lib/services/supabase/fnb-menu-estimates";

export function recipeComponentUnitCost(balance: FnbBranchComponentCost | undefined, estimate: FnbMenuEstimate | undefined): number | null {
  if (estimate && estimate.reason !== "Chưa có BOM phù hợp") return estimate.value;
  return getPreparedRecipeEstimateUnitCost(balance);
}

export function useFnbRecipeComponentCosts(enabled: boolean, branchId: string | null | undefined, productIds: string[], products: Product[]) {
  const [attempt, setAttempt] = useState(0);
  const idsKey = JSON.stringify([...new Set(productIds.filter(Boolean))].sort());
  const preparedKey = JSON.stringify(products.filter(product => product.isFnbStockItem && productIds.includes(product.id)).map(product => ({ id: product.id, code: product.code, unit: product.unit, bomCode: product.bomCode, isFnbStockItem: true })).sort((a, b) => a.id.localeCompare(b.id)));
  const scope = useMemo(() => ({ enabled: enabled && !!branchId && idsKey !== "[]", branchId, idsKey, preparedKey, attempt }), [enabled, branchId, idsKey, preparedKey, attempt]);
  const [result, setResult] = useState<{ scope: typeof scope; costs: Record<string, FnbBranchComponentCost>; estimates: Map<string, FnbMenuEstimate>; error: boolean } | null>(null);
  useEffect(() => {
    if (!scope.enabled || !scope.branchId) return;
    const controller = new AbortController();
    Promise.all([
      getFnbBranchComponentCosts(scope.branchId, JSON.parse(scope.idsKey), controller.signal),
      getFnbPreparedRecipeEstimateDetails(JSON.parse(scope.preparedKey) as Product[], scope.branchId),
    ]).then(([costs, estimates]) => {
      if (!controller.signal.aborted) setResult({ scope, costs: Object.fromEntries(costs), estimates, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ scope, costs: {}, estimates: new Map(), error: true });
    });
    return () => controller.abort();
  }, [scope]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const current = scope.enabled && result?.scope === scope;
  return {
    costs: current ? result.costs : {}, estimates: current ? result.estimates : new Map<string, FnbMenuEstimate>(),
    loading: scope.enabled && !current, error: current && result.error, retry,
  };
}
