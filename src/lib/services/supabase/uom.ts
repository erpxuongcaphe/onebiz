// UOM Conversion service — 3 unit system (purchase → stock → sell)

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantId } from "./base";
import type { UOMConversion } from "@/lib/types";

const supabase = createClient();

export async function getUOMConversions(
  productId: string
): Promise<UOMConversion[]> {
  const { data, error } = await supabase
    .from("uom_conversions")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true);

  if (error) throw error;
  return (data ?? []).map(mapConversion);
}

export async function createUOMConversion(conversion: {
  productId: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
}): Promise<UOMConversion> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("uom_conversions")
    .insert({
      tenant_id: tenantId,
      product_id: conversion.productId,
      from_unit: conversion.fromUnit,
      to_unit: conversion.toUnit,
      factor: conversion.factor,
    })
    .select()
    .single();

  if (error) throw error;
  return mapConversion(data);
}

export async function updateUOMConversion(
  id: string,
  updates: Partial<{
    fromUnit: string;
    toUnit: string;
    factor: number;
    isActive: boolean;
  }>
) {
  const updateObj: Record<string, unknown> = {};
  if (updates.fromUnit !== undefined) updateObj.from_unit = updates.fromUnit;
  if (updates.toUnit !== undefined) updateObj.to_unit = updates.toUnit;
  if (updates.factor !== undefined) updateObj.factor = updates.factor;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;

  const { error } = await supabase
    .from("uom_conversions")
    .update(updateObj)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteUOMConversion(id: string) {
  const { error } = await supabase
    .from("uom_conversions")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

// Convert quantity between units
export async function convertQuantity(
  productId: string,
  quantity: number,
  fromUnit: string,
  toUnit: string
): Promise<number> {
  if (fromUnit === toUnit) return quantity;

  const conversions = await getUOMConversions(productId);

  // Direct conversion
  const direct = conversions.find(
    (c) => c.fromUnit === fromUnit && c.toUnit === toUnit
  );
  if (direct) return quantity * direct.factor;

  // Reverse conversion
  const reverse = conversions.find(
    (c) => c.fromUnit === toUnit && c.toUnit === fromUnit
  );
  if (reverse) return quantity / reverse.factor;

  throw new Error(
    `Không tìm thấy hệ số quy đổi từ ${fromUnit} sang ${toUnit}`
  );
}

function mapConversion(row: Record<string, unknown>): UOMConversion {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    productId: row.product_id as string,
    fromUnit: row.from_unit as string,
    toUnit: row.to_unit as string,
    factor: row.factor as number,
    isActive: (row.is_active as boolean) ?? true,
    createdAt: row.created_at as string,
  };
}
