// Packaging variants service — CRUD for product_variants

import { createClient } from "@/lib/supabase/client";
import type { ProductVariant } from "@/lib/types";

const supabase = createClient();

export async function getVariantsByProduct(
  productId: string
): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(mapVariant);
}

export async function createVariant(variant: {
  productId: string;
  name: string;
  sku?: string;
  packagingType?: string;
  packagingSize?: string;
  unitCount?: number;
  barcode?: string;
  sellPrice: number;
  costPrice: number;
  weight?: number;
  isDefault?: boolean;
  sortOrder?: number;
}): Promise<ProductVariant> {
  const { data, error } = await supabase
    .from("product_variants")
    .insert({
      tenant_id: "",
      product_id: variant.productId,
      name: variant.name,
      sku: variant.sku ?? null,
      packaging_type: variant.packagingType ?? null,
      packaging_size: variant.packagingSize ?? null,
      unit_count: variant.unitCount ?? 1,
      barcode: variant.barcode ?? null,
      sell_price: variant.sellPrice,
      cost_price: variant.costPrice,
      weight: variant.weight ?? null,
      is_default: variant.isDefault ?? false,
      sort_order: variant.sortOrder ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  return mapVariant(data);
}

export async function updateVariant(
  id: string,
  updates: Partial<{
    name: string;
    sku: string;
    packagingType: string;
    packagingSize: string;
    unitCount: number;
    barcode: string;
    sellPrice: number;
    costPrice: number;
    weight: number;
    isDefault: boolean;
    isActive: boolean;
    sortOrder: number;
  }>
) {
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.sku !== undefined) updateObj.sku = updates.sku;
  if (updates.packagingType !== undefined) updateObj.packaging_type = updates.packagingType;
  if (updates.packagingSize !== undefined) updateObj.packaging_size = updates.packagingSize;
  if (updates.unitCount !== undefined) updateObj.unit_count = updates.unitCount;
  if (updates.barcode !== undefined) updateObj.barcode = updates.barcode;
  if (updates.sellPrice !== undefined) updateObj.sell_price = updates.sellPrice;
  if (updates.costPrice !== undefined) updateObj.cost_price = updates.costPrice;
  if (updates.weight !== undefined) updateObj.weight = updates.weight;
  if (updates.isDefault !== undefined) updateObj.is_default = updates.isDefault;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;
  if (updates.sortOrder !== undefined) updateObj.sort_order = updates.sortOrder;

  const { error } = await supabase
    .from("product_variants")
    .update(updateObj)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteVariant(id: string) {
  const { error } = await supabase
    .from("product_variants")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    productId: row.product_id as string,
    sku: (row.sku as string) ?? undefined,
    name: row.name as string,
    packagingType: (row.packaging_type as string) ?? undefined,
    packagingSize: (row.packaging_size as string) ?? undefined,
    unitCount: (row.unit_count as number) ?? 1,
    barcode: (row.barcode as string) ?? undefined,
    sellPrice: (row.sell_price as number) ?? 0,
    costPrice: (row.cost_price as number) ?? 0,
    weight: (row.weight as number) ?? undefined,
    isDefault: (row.is_default as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
