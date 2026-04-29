// BOM service — CRUD for production formulas

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";
import type { BOM, BOMItem, BOMCostBreakdown } from "@/lib/types";

const supabase = getClient();

export async function getAllBOMs(params?: {
  /** Filter: chỉ lấy BOM đã được sử dụng tại chi nhánh này (join production_orders). */
  usedAtBranchId?: string;
}): Promise<BOM[]> {
  let query = supabase
    .from("bom")
    .select("*, products!bom_product_id_fkey(name, code)")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  // Nếu có filter branch → chỉ trả BOM có ít nhất 1 production_order tại branch đó.
  if (params?.usedAtBranchId) {
    const { data: bomIds, error: poErr } = await supabase
      .from("production_orders")
      .select("bom_id")
      .eq("branch_id", params.usedAtBranchId);
    if (poErr) throw poErr;
    const uniqueIds = Array.from(new Set((bomIds ?? []).map((r) => r.bom_id as string).filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    query = query.in("id", uniqueIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapBOM(row as Record<string, unknown>));
}

/**
 * Lấy lịch sử production orders đã sử dụng 1 BOM.
 * Dùng cho tab "Lịch sử sản xuất" trên slide-over detail của BOM.
 */
export async function getBOMProductionHistory(
  bomId: string,
  limit = 30,
): Promise<Array<{
  id: string;
  code: string;
  branchId: string;
  branchName?: string;
  plannedQty: number;
  completedQty: number;
  status: string;
  createdAt: string;
}>> {
  const { data, error } = await supabase
    .from("production_orders")
    .select("id, code, branch_id, planned_qty, completed_qty, status, created_at, branches:branch_id(name)")
    .eq("bom_id", bomId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.code,
    branchId: row.branch_id,
    branchName: (row.branches as { name?: string } | null)?.name,
    plannedQty: Number(row.planned_qty ?? 0),
    completedQty: Number(row.completed_qty ?? 0),
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function getBOMsByProduct(productId: string): Promise<BOM[]> {
  const { data, error } = await supabase
    .from("bom")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("version", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapBOM(row as Record<string, unknown>));
}

export async function getBOMById(id: string): Promise<BOM> {
  const { data, error } = await supabase
    .from("bom")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  const bom = mapBOM(data as Record<string, unknown>);

  // Get items separately
  const { data: items } = await supabase
    .from("bom_items")
    .select("*")
    .eq("bom_id", id)
    .order("sort_order");

  bom.items = (items ?? []).map((row) => mapBOMItem(row as Record<string, unknown>));
  return bom;
}

export async function createBOM(bom: {
  productId: string;
  variantId?: string;
  code?: string;
  name: string;
  batchSize?: number;
  yieldQty?: number;
  yieldUnit?: string;
  note?: string;
  items: {
    materialId: string;
    quantity: number;
    unit: string;
    wastePercent?: number;
    sortOrder?: number;
    note?: string;
  }[];
}): Promise<BOM> {
  const tenantId = await getCurrentTenantId();
  // Create BOM header
  const { data, error } = await supabase
    .from("bom")
    .insert({
      tenant_id: tenantId,
      product_id: bom.productId,
      variant_id: bom.variantId,
      code: bom.code,
      name: bom.name,
      batch_size: bom.batchSize ?? 1,
      yield_qty: bom.yieldQty ?? 1,
      yield_unit: bom.yieldUnit ?? "cái",
      note: bom.note,
    })
    .select()
    .single();

  if (error) throw error;

  // Create BOM items
  if (bom.items.length > 0) {
    const { error: itemsError } = await supabase.from("bom_items").insert(
      bom.items.map((item, idx) => ({
        bom_id: data.id,
        material_id: item.materialId,
        quantity: item.quantity,
        unit: item.unit,
        waste_percent: item.wastePercent ?? 0,
        sort_order: item.sortOrder ?? idx,
        note: item.note ?? null,
      }))
    );

    if (itemsError) throw itemsError;
  }

  return mapBOM(data);
}

export async function updateBOM(
  id: string,
  updates: Partial<{
    name: string;
    batchSize: number;
    yieldQty: number;
    yieldUnit: string;
    note: string;
    isActive: boolean;
  }>
) {
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.batchSize !== undefined) updateObj.batch_size = updates.batchSize;
  if (updates.yieldQty !== undefined) updateObj.yield_qty = updates.yieldQty;
  if (updates.yieldUnit !== undefined) updateObj.yield_unit = updates.yieldUnit;
  if (updates.note !== undefined) updateObj.note = updates.note;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;

  const { error } = await supabase.from("bom").update(updateObj).eq("id", id);
  if (error) throw error;
}

export async function deleteBOM(id: string) {
  const { error } = await supabase.from("bom").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

export async function calculateBOMCost(
  bomId: string
): Promise<BOMCostBreakdown> {
  const { data, error } = await supabase.rpc("calculate_bom_cost", {
    p_bom_id: bomId,
  });

  if (error) throw error;
  const raw = data as Record<string, unknown>;
  return {
    bomId: raw.bom_id as string,
    totalCost: raw.total_cost as number,
    items: (raw.items as Record<string, unknown>[]).map((i) => ({
      materialId: i.material_id as string,
      materialName: i.material_name as string,
      materialCode: i.material_code as string,
      quantity: i.quantity as number,
      unit: i.unit as string,
      wastePercent: i.waste_percent as number,
      costPrice: i.cost_price as number,
      lineCost: i.line_cost as number,
    })),
  };
}

function mapBOM(row: Record<string, unknown>): BOM {
  const product = row.products as Record<string, unknown> | undefined;
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    productId: row.product_id as string,
    variantId: (row.variant_id as string) ?? undefined,
    code: (row.code as string) ?? undefined,
    name: row.name as string,
    version: (row.version as number) ?? 1,
    isActive: (row.is_active as boolean) ?? true,
    batchSize: (row.batch_size as number) ?? 1,
    yieldQty: (row.yield_qty as number) ?? 1,
    yieldUnit: (row.yield_unit as string) ?? "cái",
    note: (row.note as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    productName: product?.name as string | undefined,
    productCode: product?.code as string | undefined,
  };
}

function mapBOMItem(row: Record<string, unknown>): BOMItem {
  const material = row.products as Record<string, unknown> | undefined;
  return {
    id: row.id as string,
    bomId: row.bom_id as string,
    materialId: row.material_id as string,
    quantity: row.quantity as number,
    unit: row.unit as string,
    wastePercent: (row.waste_percent as number) ?? 0,
    sortOrder: (row.sort_order as number) ?? 0,
    note: (row.note as string) ?? undefined,
    materialName: material?.name as string | undefined,
    materialCode: material?.code as string | undefined,
    materialCostPrice: material?.cost_price as number | undefined,
  };
}
