/**
 * Supabase service: Coupons (Mã giảm giá)
 */

import type { Coupon, CouponUsage, CouponValidation, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getFilterValue, getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";

type CouponInsert = Database["public"]["Tables"]["coupons"]["Insert"];
type CouponUpdate = Database["public"]["Tables"]["coupons"]["Update"];

// --- Map DB row → Coupon ---
function mapCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    type: row.type as "fixed" | "percent",
    value: row.value as number,
    minOrderAmount: (row.min_order_amount as number) ?? 0,
    maxDiscountAmount: (row.max_discount_amount as number) ?? null,
    maxUses: (row.max_uses as number) ?? null,
    usedCount: (row.used_count as number) ?? 0,
    maxUsesPerCustomer: (row.max_uses_per_customer as number) ?? null,
    startDate: (row.start_date as string) ?? null,
    endDate: (row.end_date as string) ?? null,
    isActive: row.is_active as boolean,
    appliesTo: row.applies_to as "all" | "category" | "product",
    appliesToIds: (row.applies_to_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Lấy danh sách mã giảm giá.
 */
export async function getCoupons(params: QueryParams): Promise<QueryResult<Coupon>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("coupons")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,name.ilike.%${params.search}%`);
  }

  // Filter: is_active
  const activeFilter = getFilterValue(params.filters, "status");
  if (activeFilter === "active") query = query.eq("is_active", true);
  else if (activeFilter === "inactive") query = query.eq("is_active", false);

  // Filter: type
  const typeFilter = getFilterValue(params.filters, "type");
  if (typeFilter && typeFilter !== "all") query = query.eq("type", typeFilter as "fixed" | "percent");

  // Sort
  const sortBy = params.sortBy ?? "created_at";
  query = query.order(sortBy, { ascending: params.sortOrder === "asc" });

  // Paginate
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getCoupons");

  return {
    data: (data ?? []).map((row) => mapCoupon(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

/**
 * Lấy chi tiết 1 coupon.
 */
export async function getCouponById(id: string): Promise<Coupon | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    handleError(error, "getCouponById");
  }

  return data ? mapCoupon(data as Record<string, unknown>) : null;
}

/**
 * Tạo mã giảm giá mới.
 */
export async function createCoupon(coupon: Partial<Coupon>): Promise<Coupon> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("coupons")
    .insert({
      tenant_id: tenantId,
      code: coupon.code!,
      name: coupon.name!,
      description: coupon.description,
      type: coupon.type!,
      value: coupon.value!,
      min_order_amount: coupon.minOrderAmount ?? 0,
      max_discount_amount: coupon.maxDiscountAmount,
      max_uses: coupon.maxUses,
      max_uses_per_customer: coupon.maxUsesPerCustomer ?? 1,
      start_date: coupon.startDate,
      end_date: coupon.endDate,
      is_active: coupon.isActive ?? true,
      applies_to: coupon.appliesTo ?? "all",
      applies_to_ids: coupon.appliesToIds ?? [],
    } satisfies CouponInsert)
    .select()
    .single();

  if (error) handleError(error, "createCoupon");

  await recordAuditLog({
    entityType: "coupon",
    entityId: data.id,
    action: "create",
    newData: {
      code: data.code,
      name: data.name,
      type: data.type,
      value: data.value,
      max_uses: data.max_uses,
      end_date: data.end_date,
    },
  });

  return mapCoupon(data as Record<string, unknown>);
}

/**
 * Cập nhật mã giảm giá.
 */
export async function updateCoupon(id: string, updates: Partial<Coupon>): Promise<Coupon> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot trước update để diff trong audit log
  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("coupons")
      .select("code, name, type, value, is_active, end_date, max_uses")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  const payload: CouponUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.type !== undefined) payload.type = updates.type;
  if (updates.value !== undefined) payload.value = updates.value;
  if (updates.minOrderAmount !== undefined) payload.min_order_amount = updates.minOrderAmount;
  if (updates.maxDiscountAmount !== undefined) payload.max_discount_amount = updates.maxDiscountAmount;
  if (updates.maxUses !== undefined) payload.max_uses = updates.maxUses;
  if (updates.maxUsesPerCustomer !== undefined) payload.max_uses_per_customer = updates.maxUsesPerCustomer;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate;
  if (updates.endDate !== undefined) payload.end_date = updates.endDate;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;
  if (updates.appliesTo !== undefined) payload.applies_to = updates.appliesTo;
  if (updates.appliesToIds !== undefined) payload.applies_to_ids = updates.appliesToIds;

  const { data, error } = await supabase
    .from("coupons")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateCoupon");

  await recordAuditLog({
    entityType: "coupon",
    entityId: id,
    action:
      updates.isActive === false
        ? "deactivate"
        : updates.isActive === true
          ? "activate"
          : "update",
    oldData: oldRow ?? null,
    newData: payload as Record<string, unknown>,
  });

  return mapCoupon(data as Record<string, unknown>);
}

/**
 * Xóa mã giảm giá.
 */
export async function deleteCoupon(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot best-effort cho audit log
  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("coupons")
      .select("code, name, type, value")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  const { error } = await supabase
    .from("coupons")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "deleteCoupon");

  await recordAuditLog({
    entityType: "coupon",
    entityId: id,
    action: "delete",
    oldData: oldRow ?? null,
  });
}

/**
 * Validate & tính giảm giá cho coupon (gọi RPC).
 */
export async function validateCoupon(
  code: string,
  orderAmount: number,
  customerId?: string
): Promise<CouponValidation> {
  const supabase = getClient();

  const { data, error } = await supabase.rpc("validate_coupon", {
    p_code: code,
    p_order_amount: orderAmount,
    p_customer_id: customerId,
  });

  if (error) handleError(error, "validateCoupon");
  return data as unknown as CouponValidation;
}

/**
 * Lấy lịch sử sử dụng coupon.
 */
export async function getCouponUsages(couponId: string): Promise<CouponUsage[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("coupon_usages")
    .select("*")
    .eq("coupon_id", couponId)
    .order("used_at", { ascending: false });

  if (error) handleError(error, "getCouponUsages");

  return (data ?? []).map((row) => ({
    id: row.id,
    couponId: row.coupon_id,
    invoiceId: row.invoice_id,
    customerId: row.customer_id,
    discountAmount: row.discount_amount,
    usedAt: row.used_at,
  }));
}
