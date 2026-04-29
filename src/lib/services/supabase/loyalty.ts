/**
 * Supabase service: Loyalty (Tích điểm)
 */

import type { LoyaltySettings, LoyaltyTier, LoyaltyTransaction, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";

type TierInsert = Database["public"]["Tables"]["loyalty_tiers"]["Insert"];
type TierUpdate = Database["public"]["Tables"]["loyalty_tiers"]["Update"];

// --- Loyalty Settings ---

/**
 * Lấy cài đặt tích điểm của tenant hiện tại.
 */
export async function getLoyaltySettings(): Promise<LoyaltySettings | null> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("loyalty_settings")
    .select("*")
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // no rows
    handleError(error, "getLoyaltySettings");
  }

  if (!data) return null;

  return {
    id: data.id,
    tenantId: data.tenant_id,
    isEnabled: data.is_enabled,
    pointsPerAmount: data.points_per_amount,
    amountPerPoint: data.amount_per_point,
    redemptionPoints: data.redemption_points,
    redemptionValue: data.redemption_value,
    maxRedemptionPercent: data.max_redemption_percent,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Cập nhật hoặc tạo cài đặt tích điểm.
 */
export async function upsertLoyaltySettings(settings: Partial<LoyaltySettings>): Promise<LoyaltySettings> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("loyalty_settings")
    .upsert({
      tenant_id: settings.tenantId ?? "",
      is_enabled: settings.isEnabled ?? false,
      points_per_amount: settings.pointsPerAmount ?? 1,
      amount_per_point: settings.amountPerPoint ?? 10000,
      redemption_points: settings.redemptionPoints ?? 100,
      redemption_value: settings.redemptionValue ?? 10000,
      max_redemption_percent: settings.maxRedemptionPercent ?? 50,
    }, { onConflict: "tenant_id" })
    .select()
    .single();

  if (error) handleError(error, "upsertLoyaltySettings");

  return {
    id: data!.id,
    tenantId: data!.tenant_id,
    isEnabled: data!.is_enabled,
    pointsPerAmount: data!.points_per_amount,
    amountPerPoint: data!.amount_per_point,
    redemptionPoints: data!.redemption_points,
    redemptionValue: data!.redemption_value,
    maxRedemptionPercent: data!.max_redemption_percent,
    createdAt: data!.created_at,
    updatedAt: data!.updated_at,
  };
}

// --- Loyalty Tiers ---

/**
 * Lấy danh sách hạng thành viên.
 */
export async function getLoyaltyTiers(): Promise<LoyaltyTier[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("loyalty_tiers")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) handleError(error, "getLoyaltyTiers");

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    minPoints: row.min_points,
    discountPercent: row.discount_percent,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}

/**
 * Tạo hạng thành viên.
 */
export async function createLoyaltyTier(tier: Partial<LoyaltyTier>): Promise<LoyaltyTier> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("loyalty_tiers")
    .insert({
      tenant_id: tenantId,
      name: tier.name!,
      min_points: tier.minPoints ?? 0,
      discount_percent: tier.discountPercent ?? 0,
      sort_order: tier.sortOrder ?? 0,
      is_active: tier.isActive ?? true,
    } satisfies TierInsert)
    .select()
    .single();

  if (error) handleError(error, "createLoyaltyTier");

  return {
    id: data!.id,
    name: data!.name,
    minPoints: data!.min_points,
    discountPercent: data!.discount_percent,
    sortOrder: data!.sort_order,
    isActive: data!.is_active,
    createdAt: data!.created_at,
  };
}

/**
 * Cập nhật hạng thành viên.
 */
export async function updateLoyaltyTier(id: string, updates: Partial<LoyaltyTier>): Promise<LoyaltyTier> {
  const supabase = getClient();

  const payload: TierUpdate = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.minPoints !== undefined) payload.min_points = updates.minPoints;
  if (updates.discountPercent !== undefined) payload.discount_percent = updates.discountPercent;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  const { data, error } = await supabase
    .from("loyalty_tiers")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateLoyaltyTier");

  return {
    id: data!.id,
    name: data!.name,
    minPoints: data!.min_points,
    discountPercent: data!.discount_percent,
    sortOrder: data!.sort_order,
    isActive: data!.is_active,
    createdAt: data!.created_at,
  };
}

/**
 * Xóa hạng thành viên.
 */
export async function deleteLoyaltyTier(id: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("loyalty_tiers")
    .delete()
    .eq("id", id);

  if (error) handleError(error, "deleteLoyaltyTier");
}

// --- Loyalty Transactions ---

/**
 * Lấy lịch sử điểm thưởng.
 */
export async function getLoyaltyTransactions(params: QueryParams & { customerId?: string }): Promise<QueryResult<LoyaltyTransaction>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("loyalty_transactions")
    .select("*, customers!loyalty_transactions_customer_id_fkey(name)", { count: "exact" });

  if (params.customerId) {
    query = query.eq("customer_id", params.customerId);
  }

  query = query.order("created_at", { ascending: false });
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getLoyaltyTransactions");

  return {
    data: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      customerId: row.customer_id as string,
      customerName: ((row.customers as Record<string, unknown>)?.name as string) ?? "",
      type: row.type as LoyaltyTransaction["type"],
      points: row.points as number,
      balanceAfter: row.balance_after as number,
      referenceType: (row.reference_type as string) ?? null,
      referenceId: (row.reference_id as string) ?? null,
      note: (row.note as string) ?? null,
      createdAt: row.created_at as string,
    })),
    total: count ?? 0,
  };
}

/**
 * Tích điểm (gọi RPC earn_loyalty_points).
 */
export async function earnLoyaltyPoints(
  customerId: string,
  invoiceId: string,
  amount: number
): Promise<number> {
  const supabase = getClient();

  const { data, error } = await supabase.rpc("earn_loyalty_points", {
    p_customer_id: customerId,
    p_invoice_id: invoiceId,
    p_amount: amount,
  });

  if (error) handleError(error, "earnLoyaltyPoints");
  return data as number;
}
