"use client";
import { useEffect, useState } from "react";
import { getProductStockUnitsByIds, getUOMConversionsByProductIds } from "@/lib/services/supabase/uom";
import type { UOMConversion } from "@/lib/types";

/** One batch per list, never a request per cell. Errors are surfaced to writers. */
export function useProductUom(productIds: string[]) {
  const idsKey = [...new Set(productIds.filter(Boolean))].sort().join(",");
  const [result, setResult] = useState({ key: "", map: new Map<string, UOMConversion[]>(), units: new Map<string, string>(), error: "" });
  useEffect(() => {
    let cancelled = false;
    if (!idsKey) return;
    Promise.resolve().then(() => Promise.all([getUOMConversionsByProductIds(idsKey.split(",")),getProductStockUnitsByIds(idsKey.split(","))])).then(([result,productUnits]) => {
      if (!cancelled) setResult({ key: idsKey, map: result, units: productUnits, error: "" });
    }).catch(e => { if (!cancelled) setResult({ key: idsKey, map: new Map(), units: new Map(), error: e instanceof Error ? e.message : "Không tải được quy đổi đơn vị." }); });
    return () => { cancelled = true; };
  }, [idsKey]);
  return { map: result.key === idsKey ? result.map : new Map<string, UOMConversion[]>(), units: result.key === idsKey ? result.units : new Map<string, string>(), error: result.key === idsKey ? result.error : "", loading: !!idsKey && result.key !== idsKey };
}
