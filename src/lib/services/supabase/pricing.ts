// Pricing service — Price tiers for B2B wholesale

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantId } from "./base";
import type { PriceTier, PriceTierItem } from "@/lib/types";

const supabase = createClient();

export async function getPriceTiers(): Promise<PriceTier[]> {
  const { data, error } = await supabase
    .from("price_tiers")
    .select("*")
    .eq("is_active", true)
    .order("priority");

  if (error) throw error;

  const tiers = (data ?? []).map((row) => ({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    code: row.code as string,
    description: (row.description as string | null) ?? undefined,
    priority: row.priority as number,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    itemCount: 0,
  }));

  // Count items per tier in a single query
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

export async function getPriceTierItems(
  tierId: string
): Promise<PriceTierItem[]> {
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
  }
) {
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.code !== undefined) updateObj.code = updates.code;
  if (updates.description !== undefined) updateObj.description = updates.description;
  if (updates.priority !== undefined) updateObj.priority = updates.priority;

  const { error } = await supabase
    .from("price_tiers")
    .update(updateObj)
    .eq("id", id);

  if (error) throw error;
}

export async function deletePriceTier(id: string) {
  // Soft delete
  const { error } = await supabase
    .from("price_tiers")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

export async function addPriceTierItem(item: {
  priceTierId: string;
  productId: string;
  variantId?: string;
  price: number;
  minQty?: number;
}) {
  const { error } = await supabase.from("price_tier_items").insert({
    price_tier_id: item.priceTierId,
    product_id: item.productId,
    variant_id: item.variantId ?? null,
    price: item.price,
    min_qty: item.minQty ?? 1,
  });

  if (error) throw error;
}

export async function updatePriceTierItem(
  id: string,
  updates: { price?: number; minQty?: number }
) {
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
  const { error } = await supabase
    .from("price_tier_items")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

// Get best price for a product based on customer group
export async function getProductPriceForCustomer(
  productId: string,
  variantId?: string,
  customerGroupId?: string
): Promise<number | null> {
  // For now, get the lowest tier price
  const { data, error } = await supabase
    .from("price_tier_items")
    .select("price, min_qty")
    .eq("product_id", productId)
    .order("price", { ascending: true })
    .limit(1);

  if (error || !data?.length) return null;
  return data[0].price;
}
