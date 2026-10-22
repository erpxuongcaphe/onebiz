"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getProducts } from "@/lib/services/supabase/products";
import type { Product } from "@/lib/types";

/** Refresh on each recipe session and picker opening; ignore obsolete replies. */
export function useRecipeMaterialCatalog(
  enabled: boolean,
  onData: (products: Product[]) => void,
  fnbOnly = false,
) {
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getProducts({ page: 0, pageSize: 1000, filters: fnbOnly ? { productType: "sku" } : {} });
      if (current !== request.current) return;
      onData(result.data);
    } catch {
      if (current === request.current) {
        setError("Chưa cập nhật được danh mục thành phần. Thử lại để lấy BTP mới.");
      }
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [onData, fnbOnly]);

  useEffect(() => {
    if (enabled) void refresh();
    else setLoading(false);
    return () => { request.current++; };
  }, [enabled, refresh]);

  return { loading, error, refresh };
}
