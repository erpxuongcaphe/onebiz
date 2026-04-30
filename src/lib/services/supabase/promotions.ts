/**
 * Supabase service: Promotions (Khuyến mãi)
 *
 * Sprint KM-1 (00042): bổ sung 7 field engine + table promotion_settings.
 * Sprint KM-2 sẽ wire vào POS qua promotion-engine.ts.
 */

import type {
  Promotion,
  PromotionSettings,
  PromotionChannel,
  QueryParams,
  QueryResult,
} from "@/lib/types";
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
    // KM-1 v2 fields — fallback an toàn cho row cũ chưa có column
    channel: ((row.channel as PromotionChannel) ?? "both"),
    branchIds: (row.branch_ids as string[]) ?? [],
    usageLimit: (row.usage_limit as number) ?? null,
    usageCount: (row.usage_count as number) ?? 0,
    timeStart: (row.time_start as string) ?? null,
    timeEnd: (row.time_end as string) ?? null,
    daysOfWeek: (row.days_of_week as number[]) ?? [],
    giftProductIds: (row.gift_product_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPromotionSettings(row: Record<string, unknown>): PromotionSettings {
  return {
    tenantId: row.tenant_id as string,
    autoApplyBest: (row.auto_apply_best as boolean) ?? true,
    allowMultiple: (row.allow_multiple as boolean) ?? false,
    showOnInvoice: (row.show_on_invoice as boolean) ?? true,
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

  // Filter theo channel — dùng cho UI list lọc Retail/FnB
  const channelFilter = getFilterValue(params.filters, "channel");
  if (channelFilter && channelFilter !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).eq("channel", channelFilter);
  }

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
 * Lấy các khuyến mãi đang active trong cửa sổ start/end (chưa filter
 * channel/branch/time-of-day — engine sẽ filter ở KM-2 cho từng cart).
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: any = {
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
    // KM-1 v2 fields
    channel: promo.channel ?? "both",
    branch_ids: promo.branchIds ?? [],
    usage_limit: promo.usageLimit ?? null,
    time_start: promo.timeStart ?? null,
    time_end: promo.timeEnd ?? null,
    days_of_week: promo.daysOfWeek ?? [],
    gift_product_ids: promo.giftProductIds ?? [],
  };

  const { data, error } = await supabase
    .from("promotions")
    .insert(insertPayload satisfies PromotionInsert)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {};
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
  // KM-1 v2 fields
  if (updates.channel !== undefined) payload.channel = updates.channel;
  if (updates.branchIds !== undefined) payload.branch_ids = updates.branchIds;
  if (updates.usageLimit !== undefined) payload.usage_limit = updates.usageLimit;
  if (updates.timeStart !== undefined) payload.time_start = updates.timeStart;
  if (updates.timeEnd !== undefined) payload.time_end = updates.timeEnd;
  if (updates.daysOfWeek !== undefined) payload.days_of_week = updates.daysOfWeek;
  if (updates.giftProductIds !== undefined) payload.gift_product_ids = updates.giftProductIds;

  const { data, error } = await supabase
    .from("promotions")
    .update(payload satisfies PromotionUpdate)
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

/* ------------------------------------------------------------------ */
/*  Promotion Settings (1 row / tenant)                                */
/* ------------------------------------------------------------------ */

/**
 * Lấy cài đặt khuyến mãi của tenant. Nếu chưa có row → trả default.
 */
export async function getPromotionSettings(): Promise<PromotionSettings> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("promotion_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") handleError(error, "getPromotionSettings");

  if (!data) {
    // Default cho tenant chưa có row — UI hiện ra như đã enable
    return {
      tenantId,
      autoApplyBest: true,
      allowMultiple: false,
      showOnInvoice: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return mapPromotionSettings(data as Record<string, unknown>);
}

/**
 * KM-4: Sau khi POS checkout xong → tag promotion vào invoice.
 *
 * POS Retail tích hợp 3 field này vào posCheckout payload trực tiếp
 * (atomic). FnB dùng RPC fnb_complete_payment_atomic không nhận field
 * mới → cần helper update sau. Không atomic, nhưng acceptable vì:
 *   - usage_count đã tăng đúng ở KM-2 (atomic)
 *   - discount đã apply vào invoice.discount_amount rồi
 *   - Chỉ là metadata cho báo cáo (KM-4 page) — fail = không count vào
 *     báo cáo, nhưng invoice + thanh toán không bị ảnh hưởng.
 */
export async function tagInvoicePromotion(input: {
  invoiceId: string;
  promotionId: string;
  promotionDiscount: number;
  promotionFreeValue: number;
}): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("invoices")
    .update({
      promotion_id: input.promotionId,
      promotion_discount: input.promotionDiscount,
      promotion_free_value: input.promotionFreeValue,
    })
    .eq("tenant_id", tenantId)
    .eq("id", input.invoiceId);

  if (error) {
    // Không throw — báo cáo fail nhưng checkout vẫn ok
    console.warn("tagInvoicePromotion failed:", error);
  }
}

/**
 * Upsert cài đặt khuyến mãi (insert nếu chưa có row, update nếu có).
 * Dùng `onConflict: tenant_id` để idempotent — gọi nhiều lần không sao.
 */
export async function upsertPromotionSettings(
  input: Partial<Pick<PromotionSettings, "autoApplyBest" | "allowMultiple" | "showOnInvoice">>,
): Promise<PromotionSettings> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Lấy current để merge với partial input (giữ field không truyền)
  const current = await getPromotionSettings();

  const merged = {
    tenant_id: tenantId,
    auto_apply_best: input.autoApplyBest ?? current.autoApplyBest,
    allow_multiple: input.allowMultiple ?? current.allowMultiple,
    show_on_invoice: input.showOnInvoice ?? current.showOnInvoice,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("promotion_settings")
    .upsert(merged, { onConflict: "tenant_id" })
    .select()
    .single();

  if (error) handleError(error, "upsertPromotionSettings");
  return mapPromotionSettings(data as Record<string, unknown>);
}
