"use client";
import { useEffect, useState } from "react";
import { getProductStockUnitsByIds, getUOMConversionsByProductIds } from "@/lib/services/supabase/uom";
import type { UOMConversion } from "@/lib/types";

/** One batch per list, never a request per cell. Errors are surfaced to writers. */
export function useProductUom(productIds: string[]) {
  const idsKey = [...new Set(productIds.filter(Boolean))].sort().join(",");
  const [map, setMap] = useState<Map<string, UOMConversion[]>>(new Map());
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMap(new Map()); setUnits(new Map()); setError("");
    if (!idsKey) { setLoading(false); return; }
    setLoading(true);
    Promise.all([getUOMConversionsByProductIds(idsKey.split(",")),getProductStockUnitsByIds(idsKey.split(","))]).then(([result,productUnits]) => {
      if (!cancelled) { setMap(result); setUnits(productUnits); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được quy đổi đơn vị."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idsKey]);
  return { map, units, error, loading };
}
