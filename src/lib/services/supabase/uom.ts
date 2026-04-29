// UOM Conversion service — 3 unit system (purchase → stock → sell)
//
// Multi-tenant safety: filter tenant_id mọi query đọc, insert resolve qua
// getCurrentTenantId(). Plus: helpers rename/merge unit names (case-
// insensitive cleanup) cho trang /hang-hoa/don-vi-tinh.

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantId } from "./base";
import type { UOMConversion } from "@/lib/types";

const supabase = createClient();

export async function getUOMConversions(
  productId: string
): Promise<UOMConversion[]> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("uom_conversions")
    .select("*")
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();
  const updateObj: Record<string, unknown> = {};
  if (updates.fromUnit !== undefined) updateObj.from_unit = updates.fromUnit;
  if (updates.toUnit !== undefined) updateObj.to_unit = updates.toUnit;
  if (updates.factor !== undefined) updateObj.factor = updates.factor;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;

  const { error } = await supabase
    .from("uom_conversions")
    .update(updateObj)
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteUOMConversion(id: string) {
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from("uom_conversions")
    .update({ is_active: false })
    .eq("tenant_id", tenantId)
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

// ============================================================
// UNIT NAME MANAGEMENT (Đơn vị tính ở 3 cột products: unit,
// purchase_unit, stock_unit, sell_unit) — cho trang quản lý đơn vị
// ============================================================

/**
 * Lấy danh sách distinct unit names đang được dùng trong tenant.
 * Aggregate từ 4 cột của products: unit (legacy), purchase_unit, stock_unit,
 * sell_unit.
 *
 * Dùng cho:
 *   - Dialog tạo/sửa SP: check case-insensitive duplicate (tránh tạo "kg"
 *     khi đã có "Kg") + autocomplete suggestion.
 *   - Trang /don-vi-tinh: list để rename/merge.
 */
export async function getAllUnits(): Promise<
  Array<{ unit: string; productCount: number }>
> {
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("products")
    .select("unit, purchase_unit, stock_unit, sell_unit")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (error) throw error;

  // Aggregate distinct units + count. 1 SP có thể có 3 đơn vị khác nhau →
  // mỗi unit sẽ +1 lần dùng (không dedupe trong cùng SP để CEO biết tỷ
  // lệ unit nào dùng nhiều).
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any;
    const units = new Set<string>();
    if (r.unit) units.add(r.unit);
    if (r.purchase_unit) units.add(r.purchase_unit);
    if (r.stock_unit) units.add(r.stock_unit);
    if (r.sell_unit) units.add(r.sell_unit);
    for (const u of units) {
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([unit, productCount]) => ({ unit, productCount }))
    .sort((a, b) => b.productCount - a.productCount);
}

/**
 * Đổi tên đơn vị tính — UPDATE mass tất cả SP có unit = oldName trong
 * BẤT KỲ cột nào (unit/purchase_unit/stock_unit/sell_unit) sang newName.
 *
 * Match CASE-SENSITIVE để CEO control đúng. Ví dụ rename "Kg" → "kg":
 *   - "Kg" trong sell_unit → đổi thành "kg"
 *   - "kg" hiện đã có (lowercase) → không đụng
 *
 * Trả về số rows affected (số SP có ít nhất 1 cột bị update).
 *
 * KHÔNG dùng SQL function — ghép 4 UPDATE riêng để dễ debug + count
 * accurate. Postgres hỗ trợ CTE update batch nhưng ngại perf scan x4 lần
 * có thể bằng nhau.
 */
export async function renameUnit(
  oldName: string,
  newName: string,
): Promise<{ affectedRows: number }> {
  const tenantId = await getCurrentTenantId();
  if (!oldName.trim() || !newName.trim()) {
    throw new Error("Tên đơn vị cũ và mới không được rỗng");
  }
  if (oldName === newName) {
    return { affectedRows: 0 };
  }

  const columns = ["unit", "purchase_unit", "stock_unit", "sell_unit"] as const;
  const affectedIds = new Set<string>();

  for (const col of columns) {
    const { data, error } = await supabase
      .from("products")
      .update({ [col]: newName })
      .eq("tenant_id", tenantId)
      .eq(col, oldName)
      .select("id");

    if (error) throw error;
    for (const row of data ?? []) {
      affectedIds.add((row as { id: string }).id);
    }
  }

  return { affectedRows: affectedIds.size };
}

/**
 * Gộp 2 đơn vị: chuyển tất cả SP đang dùng `sourceName` sang `targetName`.
 *
 * Đây thực ra là alias của renameUnit — semantic khác nhưng logic giống.
 * Tách hàm để UI rõ ràng (rename = đổi format/chính tả; merge = gộp 2
 * đơn vị thực sự khác → 1).
 */
export async function mergeUnits(
  sourceName: string,
  targetName: string,
): Promise<{ affectedRows: number }> {
  return renameUnit(sourceName, targetName);
}

/**
 * Check case-insensitive: input unit có "tương đương" với unit nào đã có
 * trong tenant không. Dùng cho dialog SP để cảnh báo khi user gõ "kg"
 * mà tenant đã có "Kg".
 *
 * Trả về unit "match" (tên đã có) hoặc null nếu không có match.
 */
export async function findSimilarUnit(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const all = await getAllUnits();
  const lower = trimmed.toLowerCase();

  // Tìm exact case-insensitive match
  const match = all.find((u) => u.unit.toLowerCase() === lower);
  if (match && match.unit !== trimmed) {
    return match.unit; // có khác case → return unit đã có
  }
  return null;
}
