// Pricing service — Price tiers for B2B wholesale
//
// Multi-tenant safety:
//   - price_tiers có cột tenant_id → filter trực tiếp .eq("tenant_id", ...)
//   - price_tier_items KHÔNG có tenant_id → scope qua FK price_tier_id.
//     Mọi query items phải validate tier ownership (qua getPriceTiers
//     đã tenant-filtered) hoặc filter qua join inner price_tiers.

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantId } from "./base";
import type { PriceTier, PriceTierItem, PriceTierScope } from "@/lib/types";

const supabase = createClient();

/**
 * Get all tiers — optional filter theo scope (retail/fnb/both).
 * Khi UI hiện tab "Retail" thì chỉ load tier có scope='retail' OR 'both'.
 */
export async function getPriceTiers(filter?: {
  scope?: "retail" | "fnb"; // omit hoặc undefined = lấy tất cả
}): Promise<PriceTier[]> {
  const tenantId = await getCurrentTenantId();
  let query = supabase
    .from("price_tiers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  // Filter scope: nếu UI hiện tab "Retail" → match retail HOẶC both.
  if (filter?.scope === "retail") {
    query = query.in("scope", ["retail", "both"]);
  } else if (filter?.scope === "fnb") {
    query = query.in("scope", ["fnb", "both"]);
  }

  const { data, error } = await query.order("priority");
  if (error) throw error;

  const tiers = (data ?? []).map((row) => ({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    code: row.code as string,
    description: (row.description as string | null) ?? undefined,
    priority: row.priority as number,
    scope: ((row as { scope?: string }).scope ?? "both") as PriceTierScope,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    itemCount: 0,
  }));

  // Count items per tier in a single query — IDs đã filter tenant rồi nên
  // count safe (price_tier_items không có tenant_id, scope via FK).
  if (tiers.length > 0) {
    const ids = tiers.map((t) => t.id);
    const { data: countRows } = await supabase
      .from("price_tier_items")
      .select("price_tier_id")
      .in("price_tier_id", ids);

    if (countRows) {
      const counts = new Map<string, number>();
      for (const r of countRows as { price_tier_id: string }[]) {
        counts.set(r.price_tier_id, (counts.get(r.price_tier_id) ?? 0) + 1);
      }
      for (const t of tiers) {
        t.itemCount = counts.get(t.id) ?? 0;
      }
    }
  }

  return tiers;
}

/**
 * Validate 1 tier_id thuộc tenant hiện tại — dùng trước khi mutate items.
 * Throw nếu tier không tồn tại hoặc thuộc tenant khác.
 */
async function assertTierOwnership(tierId: string): Promise<void> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("price_tiers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", tierId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Bảng giá không tồn tại hoặc không thuộc tenant của bạn");
  }
}

export async function getPriceTierItems(
  tierId: string
): Promise<PriceTierItem[]> {
  // Defense: verify tier thuộc tenant trước khi load items
  await assertTierOwnership(tierId);

  const { data, error } = await supabase
    .from("price_tier_items")
    .select("*, products(name, code)")
    .eq("price_tier_id", tierId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => {
    const product = row.products as { name?: string; code?: string } | null;
    return {
      id: row.id,
      priceTierId: row.price_tier_id,
      productId: row.product_id,
      variantId: row.variant_id ?? undefined,
      price: row.price,
      minQty: row.min_qty,
      createdAt: row.created_at,
      productName: product?.name,
      productCode: product?.code,
    };
  });
}

export async function createPriceTier(tier: {
  name: string;
  code: string;
  description?: string;
  priority?: number;
  scope?: PriceTierScope;
}): Promise<PriceTier> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("price_tiers")
    .insert({
      tenant_id: tenantId,
      name: tier.name,
      code: tier.code,
      description: tier.description ?? null,
      priority: tier.priority ?? 0,
      scope: tier.scope ?? "both",
    })
    .select()
    .single();

  if (error) throw error;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    name: data.name,
    code: data.code,
    description: data.description ?? undefined,
    priority: data.priority,
    scope: ((data as { scope?: string }).scope ?? "both") as PriceTierScope,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function updatePriceTier(
  id: string,
  updates: {
    name?: string;
    code?: string;
    description?: string;
    priority?: number;
    scope?: PriceTierScope;
  }
) {
  const tenantId = await getCurrentTenantId();
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.code !== undefined) updateObj.code = updates.code;
  if (updates.description !== undefined) updateObj.description = updates.description;
  if (updates.priority !== undefined) updateObj.priority = updates.priority;
  if (updates.scope !== undefined) updateObj.scope = updates.scope;

  const { error } = await supabase
    .from("price_tiers")
    .update(updateObj)
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) throw error;
}

export async function deletePriceTier(id: string) {
  const tenantId = await getCurrentTenantId();
  // Soft delete
  const { error } = await supabase
    .from("price_tiers")
    .update({ is_active: false })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) throw error;
}

/**
 * Nhân bản bảng giá: tạo tier mới + copy tất cả items từ tier nguồn.
 *
 * CEO chốt Q3: hữu ích khi muốn tạo "Giá quán Q4" giống "Giá quán Q3" rồi
 * điều chỉnh vài SP. Tránh nhân viên gõ lại 100+ items.
 *
 * Logic:
 *   1. assertTierOwnership(sourceId) — verify tier thuộc tenant
 *   2. Insert tier mới với name/code do user nhập, copy description + priority
 *   3. Bulk insert items copy từ source (price + min_qty + product_id +
 *      variant_id), gắn vào tier mới
 *
 * Trả về tier mới đã tạo (có id để FE redirect/expand).
 */
export async function duplicatePriceTier(params: {
  sourceTierId: string;
  newName: string;
  newCode: string;
}): Promise<PriceTier> {
  const tenantId = await getCurrentTenantId();
  await assertTierOwnership(params.sourceTierId);

  // 1. Lấy source tier để copy description + priority + scope
  const { data: source, error: srcErr } = await supabase
    .from("price_tiers")
    .select("description, priority, scope")
    .eq("tenant_id", tenantId)
    .eq("id", params.sourceTierId)
    .single();
  if (srcErr || !source) {
    throw new Error("Không đọc được bảng giá nguồn");
  }

  // 2. Tạo tier mới — copy scope từ source
  const { data: newTier, error: createErr } = await supabase
    .from("price_tiers")
    .insert({
      tenant_id: tenantId,
      name: params.newName,
      code: params.newCode,
      description: source.description ?? null,
      priority: source.priority,
      scope: (source as { scope?: string }).scope ?? "both",
    })
    .select()
    .single();
  if (createErr) throw createErr;
  if (!newTier) throw new Error("Tạo bảng giá mới thất bại");

  // 3. Copy items từ source → new
  const { data: srcItems, error: itemsErr } = await supabase
    .from("price_tier_items")
    .select("product_id, variant_id, price, min_qty")
    .eq("price_tier_id", params.sourceTierId);
  if (itemsErr) throw itemsErr;

  if (srcItems && srcItems.length > 0) {
    const newItems = srcItems.map((it) => ({
      price_tier_id: newTier.id,
      product_id: it.product_id,
      variant_id: it.variant_id,
      price: it.price,
      min_qty: it.min_qty,
    }));
    const { error: insertErr } = await supabase
      .from("price_tier_items")
      .insert(newItems);
    if (insertErr) {
      // Rollback: xoá tier mới (cascade sẽ xoá items đã insert)
      await supabase.from("price_tiers").delete().eq("id", newTier.id);
      throw new Error(
        `Lỗi copy sản phẩm: ${insertErr.message}. Đã rollback bảng giá mới.`,
      );
    }
  }

  return {
    id: newTier.id,
    tenantId: newTier.tenant_id,
    name: newTier.name,
    code: newTier.code,
    description: newTier.description ?? undefined,
    priority: newTier.priority,
    scope: ((newTier as { scope?: string }).scope ?? "both") as PriceTierScope,
    isActive: newTier.is_active,
    createdAt: newTier.created_at,
    updatedAt: newTier.updated_at,
  };
}

/**
 * Wrapper resolve tier ÁP DỤNG + LẤY PRICE MAP cho 1 lần fetch:
 *   1. getApplicableTier → tierId từ customer/branch
 *   2. Get tier info (name, code)
 *   3. getTierPricesBatch → Map<productId, price>
 *
 * Dùng trong POS để re-price cart khi customer/branch thay đổi.
 * Trả null nếu không có tier mặc định → caller fallback giá niêm yết.
 */
export async function resolveAppliedTier(context: {
  channel: "retail" | "fnb";
  customerId?: string;
  branchId?: string;
  productIds: string[];
}): Promise<{
  tierId: string;
  tierName: string;
  tierCode: string;
  priceMap: Map<string, number>;
} | null> {
  const tierId = await getApplicableTier({
    channel: context.channel,
    customerId: context.customerId,
    branchId: context.branchId,
  });
  if (!tierId) return null;

  const tenantId = await getCurrentTenantId();

  // Get tier info
  const { data: tier } = await supabase
    .from("price_tiers")
    .select("id, name, code")
    .eq("tenant_id", tenantId)
    .eq("id", tierId)
    .single();
  if (!tier) return null;

  // Batch lookup prices
  const tierPrices = await getTierPricesBatch(tierId, context.productIds);
  const priceMap = new Map<string, number>();
  for (const [productId, entry] of tierPrices.entries()) {
    if (entry.base !== null) {
      priceMap.set(productId, entry.base);
    }
    // variant prices (nếu cần) — POS hiện match by productId, variant
    // override sẽ làm sau khi cần.
  }

  return {
    tierId: tier.id,
    tierName: tier.name,
    tierCode: tier.code,
    priceMap,
  };
}

/**
 * Resolve tier áp dụng tại lúc check out cho 1 context cụ thể.
 *
 * Logic ưu tiên:
 *   - POS Retail (channel='retail'): customers.price_tier_id ?? null
 *   - POS FnB    (channel='fnb'):    branches.price_tier_id ?? null
 *
 * Trả về tierId để caller dùng tiếp với getTierPricesBatch / pricing
 * lookup cho từng SP. Trả null nếu không có tier mặc định → fallback
 * giá niêm yết SP.
 *
 * Q2 CEO chốt: KHÔNG cho cashier override → service không nhận tham số
 * override. Nếu sau này cần Q2 Hybrid (PIN supervisor), expose param ở đây.
 */
export async function getApplicableTier(context: {
  channel: "retail" | "fnb";
  customerId?: string;
  branchId?: string;
}): Promise<string | null> {
  const tenantId = await getCurrentTenantId();

  if (context.channel === "retail" && context.customerId) {
    const { data, error } = await supabase
      .from("customers")
      .select("price_tier_id")
      .eq("tenant_id", tenantId)
      .eq("id", context.customerId)
      .maybeSingle();
    if (error || !data) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data as any).price_tier_id as string | null) ?? null;
  }

  if (context.channel === "fnb" && context.branchId) {
    const { data, error } = await supabase
      .from("branches")
      .select("price_tier_id")
      .eq("tenant_id", tenantId)
      .eq("id", context.branchId)
      .maybeSingle();
    if (error || !data) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data as any).price_tier_id as string | null) ?? null;
  }

  return null;
}

export async function addPriceTierItem(item: {
  priceTierId: string;
  productId: string;
  variantId?: string;
  price: number;
  minQty?: number;
}) {
  await assertTierOwnership(item.priceTierId);
  const { error } = await supabase.from("price_tier_items").insert({
    price_tier_id: item.priceTierId,
    product_id: item.productId,
    variant_id: item.variantId ?? null,
    price: item.price,
    min_qty: item.minQty ?? 1,
  });

  if (error) throw error;
}

/**
 * Bulk add nhiều items vào tier 1 lần. Dùng cho Sprint 3 UX:
 *  - "Thêm hàng loạt theo nhóm" — CEO chọn category → 50 SP → 1 giá
 *  - "Điều chỉnh % giá niêm yết" — bulk gen items với price = sellPrice ± X%
 *
 * Logic UPSERT: nếu SP đã có trong tier → UPDATE price + min_qty (không
 * duplicate). Pattern: delete trước insert HOẶC dùng .upsert. Em dùng
 * delete-then-insert vì price_tier_items không có composite unique key
 * trên (price_tier_id, product_id, variant_id) — defensive: clear hết
 * các SP đang được bulk update rồi insert lại.
 *
 * Trả về: số items đã thêm/update.
 */
export async function bulkAddPriceTierItems(params: {
  priceTierId: string;
  items: Array<{
    productId: string;
    variantId?: string;
    price: number;
    minQty?: number;
  }>;
}): Promise<{ insertedCount: number }> {
  if (params.items.length === 0) return { insertedCount: 0 };
  await assertTierOwnership(params.priceTierId);

  // Step 1: Xoá các items cũ (cùng tier + cùng productId) để tránh
  // duplicate. Pattern này an toàn với upsert vì không phụ thuộc unique
  // constraint (price_tier_items không có).
  const productIds = params.items.map((i) => i.productId);
  const { error: deleteErr } = await supabase
    .from("price_tier_items")
    .delete()
    .eq("price_tier_id", params.priceTierId)
    .in("product_id", productIds);
  if (deleteErr) throw deleteErr;

  // Step 2: Bulk insert items mới
  const rows = params.items.map((it) => ({
    price_tier_id: params.priceTierId,
    product_id: it.productId,
    variant_id: it.variantId ?? null,
    price: it.price,
    min_qty: it.minQty ?? 1,
  }));

  const { error: insertErr, data } = await supabase
    .from("price_tier_items")
    .insert(rows)
    .select("id");
  if (insertErr) throw insertErr;

  return { insertedCount: data?.length ?? 0 };
}

export async function updatePriceTierItem(
  id: string,
  updates: { price?: number; minQty?: number }
) {
  // Verify item thuộc tenant qua join price_tiers.
  // Pattern: query item + tier in 1 read, validate, then update by id.
  const tenantId = await getCurrentTenantId();
  const { data: item, error: fetchErr } = await supabase
    .from("price_tier_items")
    .select("id, price_tiers!inner(tenant_id)")
    .eq("id", id)
    .single();
  if (fetchErr || !item) {
    throw new Error("Item bảng giá không tồn tại");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tier = (item as any).price_tiers;
  const tierTenantId = Array.isArray(tier) ? tier[0]?.tenant_id : tier?.tenant_id;
  if (tierTenantId !== tenantId) {
    throw new Error("Item bảng giá không thuộc tenant của bạn");
  }

  const updateObj: Record<string, unknown> = {};
  if (updates.price !== undefined) updateObj.price = updates.price;
  if (updates.minQty !== undefined) updateObj.min_qty = updates.minQty;

  const { error } = await supabase
    .from("price_tier_items")
    .update(updateObj)
    .eq("id", id);

  if (error) throw error;
}

export async function deletePriceTierItem(id: string) {
  // Validate ownership trước khi xoá (defense-in-depth)
  const tenantId = await getCurrentTenantId();
  const { data: item, error: fetchErr } = await supabase
    .from("price_tier_items")
    .select("id, price_tiers!inner(tenant_id)")
    .eq("id", id)
    .single();
  if (fetchErr || !item) {
    throw new Error("Item bảng giá không tồn tại");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tier = (item as any).price_tiers;
  const tierTenantId = Array.isArray(tier) ? tier[0]?.tenant_id : tier?.tenant_id;
  if (tierTenantId !== tenantId) {
    throw new Error("Item bảng giá không thuộc tenant của bạn");
  }

  const { error } = await supabase
    .from("price_tier_items")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

// Get best price for a product/variant (optionally scoped to a price tier).
// Tenant scope via inner join price_tiers — đảm bảo không leak tier
// của tenant khác qua productId share giữa tenants.
export async function getProductPriceForCustomer(
  productId: string,
  variantId?: string,
  tierId?: string
): Promise<number | null> {
  const tenantId = await getCurrentTenantId();
  let query = supabase
    .from("price_tier_items")
    .select("price, min_qty, variant_id, price_tier_id, price_tiers!inner(tenant_id)")
    .eq("price_tiers.tenant_id", tenantId)
    .eq("product_id", productId);

  if (tierId) query = query.eq("price_tier_id", tierId);
  if (variantId) {
    query = query.or(`variant_id.eq.${variantId},variant_id.is.null`);
  }

  const { data, error } = await query.order("price", { ascending: true }).limit(5);

  if (error || !data?.length) return null;

  const variantMatch = variantId
    ? data.find((r) => r.variant_id === variantId)
    : null;
  if (variantMatch) return variantMatch.price;

  return data[0].price;
}

// Batch tier prices — tenant-scoped via inner join.
export async function getTierPricesBatch(
  tierId: string,
  productIds: string[]
): Promise<Map<string, { base: number | null; byVariant: Map<string, number> }>> {
  if (productIds.length === 0) return new Map();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("price_tier_items")
    .select("product_id, variant_id, price, price_tiers!inner(tenant_id)")
    .eq("price_tiers.tenant_id", tenantId)
    .eq("price_tier_id", tierId)
    .in("product_id", productIds);

  if (error || !data) return new Map();

  const result = new Map<
    string,
    { base: number | null; byVariant: Map<string, number> }
  >();

  for (const row of data) {
    const productId = row.product_id as string;
    const variantId = row.variant_id as string | null;
    const price = row.price as number;

    if (!result.has(productId)) {
      result.set(productId, { base: null, byVariant: new Map() });
    }
    const entry = result.get(productId)!;

    if (variantId) {
      entry.byVariant.set(variantId, price);
    } else {
      entry.base = price;
    }
  }

  return result;
}
