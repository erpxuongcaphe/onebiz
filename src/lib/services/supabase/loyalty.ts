/**
 * Supabase service: Loyalty (Tích điểm)
 */

import type { LoyaltySettings, LoyaltyTier, LoyaltyTransaction, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";

type TierInsert = Database["public"]["Tables"]["loyalty_tiers"]["Insert"];
type TierUpdate = Database["public"]["Tables"]["loyalty_tiers"]["Update"];

// --- Loyalty Settings ---

/**
 * Lấy cài đặt tích điểm của tenant hiện tại.
 */
export async function getLoyaltySettings(): Promise<LoyaltySettings | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("loyalty_settings")
    .select("*")
    .eq("tenant_id", tenantId)
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
  // tenant_id LẤY TỪ session (KHÔNG nhận từ caller — tránh inject vào tenant khác)
  const tenantId = await getCurrentTenantId();

  // Merge với current — caller chỉ truyền field cần update
  const current = await getLoyaltySettings();
  const merged = {
    tenant_id: tenantId,
    is_enabled: settings.isEnabled ?? current?.isEnabled ?? false,
    points_per_amount: settings.pointsPerAmount ?? current?.pointsPerAmount ?? 1,
    amount_per_point: settings.amountPerPoint ?? current?.amountPerPoint ?? 10000,
    redemption_points: settings.redemptionPoints ?? current?.redemptionPoints ?? 100,
    redemption_value: settings.redemptionValue ?? current?.redemptionValue ?? 10000,
    max_redemption_percent:
      settings.maxRedemptionPercent ?? current?.maxRedemptionPercent ?? 50,
  };

  const { data, error } = await supabase
    .from("loyalty_settings")
    .upsert(merged, { onConflict: "tenant_id" })
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
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("loyalty_tiers")
    .select("*")
    .eq("tenant_id", tenantId)
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

  await recordAuditLog({
    entityType: "loyalty_tier",
    entityId: data!.id,
    action: "create",
    newData: {
      name: data!.name,
      min_points: data!.min_points,
      discount_percent: data!.discount_percent,
    },
  });

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
  const tenantId = await getCurrentTenantId();

  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("loyalty_tiers")
      .select("name, min_points, discount_percent, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  const payload: TierUpdate = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.minPoints !== undefined) payload.min_points = updates.minPoints;
  if (updates.discountPercent !== undefined) payload.discount_percent = updates.discountPercent;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  const { data, error } = await supabase
    .from("loyalty_tiers")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateLoyaltyTier");

  await recordAuditLog({
    entityType: "loyalty_tier",
    entityId: id,
    action: "update",
    oldData: oldRow ?? null,
    newData: payload as Record<string, unknown>,
  });

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
  const tenantId = await getCurrentTenantId();

  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("loyalty_tiers")
      .select("name, min_points, discount_percent")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  const { error } = await supabase
    .from("loyalty_tiers")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "deleteLoyaltyTier");

  await recordAuditLog({
    entityType: "loyalty_tier",
    entityId: id,
    action: "delete",
    oldData: oldRow ?? null,
  });
}

// --- Loyalty Transactions ---

/**
 * Lấy lịch sử điểm thưởng.
 */
export async function getLoyaltyTransactions(params: QueryParams & { customerId?: string }): Promise<QueryResult<LoyaltyTransaction>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("loyalty_transactions")
    .select("*, customers!loyalty_transactions_customer_id_fkey(name)", { count: "exact" })
    .eq("tenant_id", tenantId);

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

/**
 * L-3: Đổi điểm lấy giảm giá (gọi RPC redeem_loyalty_points).
 *
 * Atomic decrement points + log loyalty_transactions. Discount amount
 * client tính trước qua calculateRedeemDiscount() — server chỉ trừ điểm.
 *
 * Trả về số điểm còn lại sau khi đổi. Throw nếu KH không đủ điểm.
 */
export async function redeemLoyaltyPoints(
  customerId: string,
  points: number,
  invoiceId: string,
): Promise<number> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("redeem_loyalty_points", {
    p_customer_id: customerId,
    p_points: points,
    p_invoice_id: invoiceId,
  });

  if (error) handleError(error, "redeemLoyaltyPoints");
  return data as number;
}

/**
 * L-3: Pure helper — tính discount amount từ số điểm muốn đổi + settings.
 *
 *   discount = floor(points / redemptionPoints) × redemptionValue
 *   capped by orderTotal × maxRedemptionPercent / 100
 *
 * Returns:
 *   - discountAmount: VND giảm cuối cùng (đã cap)
 *   - effectivePoints: số điểm sẽ thực sự bị trừ (= multiple của
 *     redemptionPoints để tránh thừa, vd KH nhập 150 nhưng redeem step
 *     là 100 → effective = 100 → discount = 1 × 10000 = 10000đ).
 */
export function calculateRedeemDiscount(
  points: number,
  settings: Pick<LoyaltySettings, "redemptionPoints" | "redemptionValue" | "maxRedemptionPercent">,
  orderTotal: number,
): { discountAmount: number; effectivePoints: number } {
  if (points <= 0 || settings.redemptionPoints <= 0) {
    return { discountAmount: 0, effectivePoints: 0 };
  }
  const units = Math.floor(points / settings.redemptionPoints);
  if (units === 0) return { discountAmount: 0, effectivePoints: 0 };

  const rawDiscount = units * settings.redemptionValue;
  const cap = Math.floor((orderTotal * settings.maxRedemptionPercent) / 100);
  const discountAmount = Math.min(rawDiscount, cap);
  // Tính lại effectivePoints theo discount (sau cap) để KH không bị trừ thừa
  const effectiveUnits =
    settings.redemptionValue > 0
      ? Math.ceil(discountAmount / settings.redemptionValue)
      : 0;
  const effectivePoints = effectiveUnits * settings.redemptionPoints;

  return { discountAmount, effectivePoints };
}
