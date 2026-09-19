import { getClient, getCurrentContext, handleError } from "./base";

export interface InternalSaleProduct {
  id: string;
  code: string;
  name: string;
  unit: string;
  sell_price: number;
  vat_rate: number;
}

// Quote PostgREST values as well as escaping SQL LIKE wildcards.
export function internalSaleSearchFilter(search: string): string {
  const literal = search.trim().replace(/[\\%_*]/g, "\\$&");
  const value = JSON.stringify(`%${literal}%`);
  return `name.ilike.${value},code.ilike.${value}`;
}

export async function searchInternalSaleProducts(
  search: string,
  signal?: AbortSignal,
  retailSkuOnly = false,
  approvedProductIds?: string[],
): Promise<InternalSaleProduct[]> {
  if (!search.trim() || signal?.aborted) return [];
  if (approvedProductIds && approvedProductIds.length === 0) return [];
  const ctx = await getCurrentContext();
  if (signal?.aborted) return [];
  let query = getClient()
    .from("products")
    .select("id, code, name, unit, sell_price, vat_rate")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true)
    // Keep NVL transfers valid; only menu SKUs are forbidden in internal sales.
    .or("product_type.neq.sku,channel.is.null,channel.neq.fnb")
    .or(internalSaleSearchFilter(search))
    .order("code")
    .limit(8);
  if (retailSkuOnly) query = query.eq("product_type", "sku");
  if (approvedProductIds) query = query.in("id", approvedProductIds);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (signal?.aborted) return [];
  if (error) handleError(error, "searchInternalSaleProducts");
  return (data ?? []).map((product) => ({
    ...product,
    vat_rate: product.vat_rate ?? 0,
  }));
}
