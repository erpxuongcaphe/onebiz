/**
 * Product Platform Prices Service (CEO 13/05/2026, tham khảo Fabi/iPos).
 *
 * Mỗi sản phẩm có thể có giá KHÁC NHAU theo nguồn đơn (Shopee Food / Grab /
 * Gojek / Be). VD: cà phê đá tại quán 25k, Shopee Food 26k.
 *
 * 2 UI cùng đọc/ghi 1 bảng `product_platform_prices`:
 *   - UI #1: tab "Giá theo nền tảng" trong product detail (/hang-hoa)
 *   - UI #2: bulk matrix editor (/cai-dat/bang-gia/platforms)
 *
 * POS FnB resolve giá:
 *   - Tab.deliveryPlatform = "shopee_food" → check override → fallback sell_price
 *   - Tab.deliveryPlatform = "direct" → luôn = sell_price (KHÔNG override)
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import type { DeliveryPlatform } from "@/lib/types/fnb";

// ============================================================
// Types
// ============================================================

export interface ProductPlatformPrice {
  id: string;
  productId: string;
  platform: DeliveryPlatform;
  overridePrice: number;
  setAt: string;
  setBy: string | null;
}

export interface ProductPlatformPriceUpsert {
  productId: string;
  platform: DeliveryPlatform;
  overridePrice: number;
}

/** Row dùng cho bulk matrix UI: 1 SP + map platform → price. */
export interface ProductWithPlatformPrices {
  productId: string;
  productCode: string;
  productName: string;
  categoryName: string | null;
  basePrice: number; // sell_price (giá niêm yết)
  prices: Partial<Record<DeliveryPlatform, number>>;
}

// ============================================================
// Service functions
// ============================================================

/**
 * Lấy tất cả override price của 1 SP cho mọi platform.
 * Dùng ở UI tab "Giá theo nền tảng" trong product detail.
 */
export async function getPlatformPricesForProduct(
  productId: string,
): Promise<ProductPlatformPrice[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("product_platform_prices")
    .select("id, product_id, platform, override_price, set_at, set_by")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId);

  if (error) {
    handleError(error, "getPlatformPricesForProduct");
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    productId: String(r.product_id),
    platform: r.platform as DeliveryPlatform,
    overridePrice: Number(r.override_price),
    setAt: String(r.set_at),
    setBy: r.set_by ? String(r.set_by) : null,
  }));
}

/**
 * Lấy override của tất cả SP × platform (cho UI bulk matrix).
 * Trả về list SP kèm map platform → price.
 */
export async function getProductsWithPlatformPrices(params?: {
  categoryId?: string;
  search?: string;
  limit?: number;
}): Promise<ProductWithPlatformPrices[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Step 1: query products (filter + pagination)
  let prodQuery = supabase
    .from("products")
    .select(
      "id, code, name, sell_price, category_id, categories!products_category_id_fkey(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("channel", "fnb") // chỉ menu FnB cần platform pricing
    .order("name")
    .limit(params?.limit ?? 500);

  if (params?.categoryId) prodQuery = prodQuery.eq("category_id", params.categoryId);
  if (params?.search) prodQuery = prodQuery.ilike("name", `%${params.search}%`);

  const { data: products, error: prodErr } = await prodQuery;
  if (prodErr) handleError(prodErr, "getProductsWithPlatformPrices.products");

  if (!products || products.length === 0) return [];

  // Step 2: batch query platform_prices cho các SP đó
  const productIds = products.map((p: { id: string }) => p.id);
  const { data: overrides, error: overErr } = await supabase
    .from("product_platform_prices")
    .select("product_id, platform, override_price")
    .eq("tenant_id", tenantId)
    .in("product_id", productIds);

  if (overErr) handleError(overErr, "getProductsWithPlatformPrices.overrides");

  // Step 3: group overrides by product_id
  const overrideMap = new Map<string, Partial<Record<DeliveryPlatform, number>>>();
  for (const o of overrides ?? []) {
    const row = o as Record<string, unknown>;
    const pid = String(row.product_id);
    if (!overrideMap.has(pid)) overrideMap.set(pid, {});
    overrideMap.get(pid)![row.platform as DeliveryPlatform] = Number(
      row.override_price,
    );
  }

  return products.map((p: Record<string, unknown>) => ({
    productId: String(p.id),
    productCode: String(p.code),
    productName: String(p.name),
    categoryName: (p.categories as { name?: string } | null)?.name ?? null,
    basePrice: Number(p.sell_price),
    prices: overrideMap.get(String(p.id)) ?? {},
  }));
}

/**
 * Bulk upsert override price.
 * Mỗi row: { productId, platform, overridePrice }.
 * Dùng cho cả 2 UI: tab detail (1-5 row) và bulk matrix (N row).
 */
export async function upsertPlatformPrices(
  rows: ProductPlatformPriceUpsert[],
): Promise<{ count: number }> {
  const supabase = getClient();

  if (rows.length === 0) return { count: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "upsert_product_platform_prices",
    {
      p_rows: rows.map((r) => ({
        product_id: r.productId,
        platform: r.platform,
        override_price: r.overridePrice,
      })),
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC upsert_product_platform_prices. Vui lòng chạy migration 00068 trước.",
      );
    }
    handleError(error, "upsertPlatformPrices");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả lưu hợp lệ.");
  }

  return { count: Number((data as { count?: number }).count ?? rows.length) };
}

/**
 * Xoá override cho 1 platform của N sản phẩm (vd "Xoá tất cả override Shopee").
 */
export async function deletePlatformPrices(
  productIds: string[],
  platform: DeliveryPlatform,
): Promise<{ deleted: number }> {
  const supabase = getClient();

  if (productIds.length === 0) return { deleted: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "delete_product_platform_prices",
    {
      p_product_ids: productIds,
      p_platform: platform,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC delete_product_platform_prices. Vui lòng chạy migration 00068.",
      );
    }
    handleError(error, "deletePlatformPrices");
  }

  return { deleted: Number((data as { deleted?: number })?.deleted ?? 0) };
}

/**
 * Helper resolve giá cho POS FnB: cho 1 SP + platform → trả giá đúng.
 * Used inline (không qua DB) sau khi đã load list overrides 1 lần ở mount.
 */
export function resolveProductPrice(
  basePrice: number,
  platformOverrides: Partial<Record<DeliveryPlatform, number>>,
  platform: DeliveryPlatform | undefined,
): number {
  if (!platform || platform === "direct") return basePrice;
  const override = platformOverrides[platform];
  return override !== undefined ? override : basePrice;
}
