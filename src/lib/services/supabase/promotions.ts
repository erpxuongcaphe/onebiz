/**
 * Supabase service: Promotions (Khuyến mãi)
 */

import type { Promotion, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getFilterValue, getCurrentTenantId } from "./base";

type PromotionInsert = Database["public"]["Tables"]["promotions"]["Insert"];
type PromotionUpdate = Database["public"]["Tables"]["promotions"]["Update"];

function mapPromotion(row: Record<string, unknown>): Promotion {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    type: row.type as Promotion["type"],
    value: row.value as number,
    minOrderAmount: (row.min_order_amount as number) ?? 0,
    buyQuantity: (row.buy_quantity as number) ?? null,
    getQuantity: (row.get_quantity as number) ?? null,
    appliesTo: row.applies_to as "all" | "category" | "product",
    appliesToIds: (row.applies_to_ids as string[]) ?? [],
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    isActive: row.is_active as boolean,
    autoApply: row.auto_apply as boolean,
    priority: row.priority as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Lấy danh sách khuyến mãi.
 */
export async function getPromotions(params: QueryParams): Promise<QueryResult<Promotion>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("promotions")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

  if (params.search) {
    query = query.ilike("name", `%${params.search}%`);
  }

  const activeFilter = getFilterValue(params.filters, "status");
  if (activeFilter === "active") query = query.eq("is_active", true);
  else if (activeFilter === "inactive") query = query.eq("is_active", false);

  const typeFilter = getFilterValue(params.filters, "type");
  if (typeFilter && typeFilter !== "all") query = query.eq("type", typeFilter as Promotion["type"]);

  const sortBy = params.sortBy ?? "priority";
  query = query.order(sortBy, { ascending: params.sortOrder === "asc" });
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getPromotions");

  return {
    data: (data ?? []).map((row) => mapPromotion(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

/**
 * Lấy các khuyến mãi đang hoạt động (auto_apply).
 */
export async function getActivePromotions(): Promise<Promotion[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .lte("start_date", now)
    .gte("end_date", now)
    .order("priority", { ascending: false });

  if (error) handleError(error, "getActivePromotions");
  return (data ?? []).map((row) => mapPromotion(row as Record<string, unknown>));
}

/**
 * Tạo khuyến mãi mới.
 */
export async function createPromotion(promo: Partial<Promotion>): Promise<Promotion> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("promotions")
    .insert({
      tenant_id: tenantId,
      name: promo.name!,
      description: promo.description,
      type: promo.type!,
      value: promo.value!,
      min_order_amount: promo.minOrderAmount ?? 0,
      buy_quantity: promo.buyQuantity,
      get_quantity: promo.getQuantity,
      applies_to: promo.appliesTo ?? "all",
      applies_to_ids: promo.appliesToIds ?? [],
      start_date: promo.startDate!,
      end_date: promo.endDate!,
      is_active: promo.isActive ?? true,
      auto_apply: promo.autoApply ?? false,
      priority: promo.priority ?? 0,
    } satisfies PromotionInsert)
    .select()
    .single();

  if (error) handleError(error, "createPromotion");
  return mapPromotion(data as Record<string, unknown>);
}

/**
 * Cập nhật khuyến mãi.
 */
export async function updatePromotion(id: string, updates: Partial<Promotion>): Promise<Promotion> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const payload: PromotionUpdate = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.type !== undefined) payload.type = updates.type;
  if (updates.value !== undefined) payload.value = updates.value;
  if (updates.minOrderAmount !== undefined) payload.min_order_amount = updates.minOrderAmount;
  if (updates.buyQuantity !== undefined) payload.buy_quantity = updates.buyQuantity;
  if (updates.getQuantity !== undefined) payload.get_quantity = updates.getQuantity;
  if (updates.appliesTo !== undefined) payload.applies_to = updates.appliesTo;
  if (updates.appliesToIds !== undefined) payload.applies_to_ids = updates.appliesToIds;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate;
  if (updates.endDate !== undefined) payload.end_date = updates.endDate;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;
  if (updates.autoApply !== undefined) payload.auto_apply = updates.autoApply;
  if (updates.priority !== undefined) payload.priority = updates.priority;

  const { data, error } = await supabase
    .from("promotions")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updatePromotion");
  return mapPromotion(data as Record<string, unknown>);
}

/**
 * Xóa khuyến mãi.
 */
export async function deletePromotion(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("promotions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "deletePromotion");
}
