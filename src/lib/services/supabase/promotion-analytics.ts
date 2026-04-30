/**
 * Promotion Analytics — Sprint KM-4
 *
 * Báo cáo hiệu quả khuyến mãi cho CEO. Mọi query scope theo tenant_id +
 * promotion_id (KM-4 migration 00044 thêm `invoices.promotion_id`).
 *
 * Các metric:
 *   - getPromotionKpis():           Tổng lượt dùng, tổng giảm, doanh thu từ
 *                                   đơn có KM, KM đang active
 *   - getTopPromotions():           Top KM theo discount/usage trong period
 *   - getPromotionDailyTrend():     Lượt dùng + discount theo ngày (chart)
 *   - getPromotionDetailRows():     Bảng chi tiết per-promo: campaigns
 */

import type { Promotion } from "@/lib/types";
import { getClient, handleError, getCurrentTenantId } from "./base";

// ============================================================
// Types
// ============================================================

export interface PromotionKpis {
  /** Tổng số đơn có áp KM trong period */
  totalUsageCount: number;
  /** Tổng tiền giảm bởi KM */
  totalDiscount: number;
  /** Tổng trị giá hàng tặng (BOGO + gift) */
  totalFreeValue: number;
  /** Doanh thu từ các đơn có áp KM (sau khi giảm) */
  revenueWithPromo: number;
  /** Số KM đang active (is_active + start_date <= now <= end_date) */
  activePromotionsCount: number;
  /** ROI ước lượng = revenueWithPromo / (discount + freeValue), >1 nghĩa lời */
  estimatedRoi: number;
}

export interface PromotionDetailRow {
  promotionId: string;
  name: string;
  type: Promotion["type"];
  channel: "retail" | "fnb" | "both";
  /** Số đơn áp dụng KM trong period */
  invoiceCount: number;
  /** Tổng tiền giảm bởi KM trong period */
  totalDiscount: number;
  /** Tổng trị giá hàng tặng */
  totalFreeValue: number;
  /** Tổng doanh thu (after discount) các đơn có áp KM */
  totalRevenue: number;
  /** Discount trung bình / đơn */
  avgDiscountPerInvoice: number;
  /** Lifetime usage_count (từ promotions.usage_count) */
  lifetimeUsageCount: number;
  /** Limit nếu có */
  usageLimit: number | null;
}

export interface PromotionDailyPoint {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Số đơn áp KM trong ngày */
  usageCount: number;
  /** Tổng giảm trong ngày */
  totalDiscount: number;
}

// ============================================================
// Helpers
// ============================================================

function defaultRange(days: number = 30): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ============================================================
// KPIs
// ============================================================

/**
 * Tổng quan hiệu quả KM trong period (mặc định 30 ngày).
 *
 * Note: chỉ count invoices.status='completed' để loại đơn nháp/huỷ.
 */
export async function getPromotionKpis(params?: {
  startDate?: string;
  endDate?: string;
  branchId?: string;
}): Promise<PromotionKpis> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = {
    start: params?.startDate ?? defaultRange().start,
    end: params?.endDate ?? defaultRange().end,
  };

  // Parallel: invoices có promo + count active promotions
  let invQuery = supabase
    .from("invoices")
    .select("total, promotion_discount, promotion_free_value")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("promotion_id", "is", null)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (params?.branchId) invQuery = invQuery.eq("branch_id", params.branchId);

  const now = new Date().toISOString();
  const promoQuery = supabase
    .from("promotions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .lte("start_date", now)
    .gte("end_date", now);

  const [invRes, promoRes] = await Promise.all([invQuery, promoQuery]);

  if (invRes.error) handleError(invRes.error, "getPromotionKpis:invoices");

  const rows = (invRes.data ?? []) as Array<{
    total: number;
    promotion_discount: number;
    promotion_free_value: number;
  }>;

  const totalUsageCount = rows.length;
  const totalDiscount = rows.reduce((s, r) => s + Number(r.promotion_discount ?? 0), 0);
  const totalFreeValue = rows.reduce((s, r) => s + Number(r.promotion_free_value ?? 0), 0);
  const revenueWithPromo = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const totalCost = totalDiscount + totalFreeValue;
  const estimatedRoi = totalCost > 0 ? Math.round((revenueWithPromo / totalCost) * 100) / 100 : 0;

  return {
    totalUsageCount,
    totalDiscount,
    totalFreeValue,
    revenueWithPromo,
    activePromotionsCount: promoRes.count ?? 0,
    estimatedRoi,
  };
}

// ============================================================
// Detail rows per promotion
// ============================================================

/**
 * Bảng chi tiết hiệu quả per-promotion. Sort theo totalDiscount desc.
 *
 * Fetch tất cả promotions của tenant (active + inactive — CEO muốn xem cả
 * KM đã hết hạn để học), sau đó join với invoices có promotion_id match
 * trong period. Aggregate ở client để đơn giản — promotions list thường
 * <= 50 cho mỗi tenant nên không cần SQL aggregate.
 */
export async function getPromotionDetailRows(params?: {
  startDate?: string;
  endDate?: string;
  branchId?: string;
}): Promise<PromotionDetailRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const range = {
    start: params?.startDate ?? defaultRange().start,
    end: params?.endDate ?? defaultRange().end,
  };

  const [promosRes, invRes] = await Promise.all([
    supabase
      .from("promotions")
      .select(
        "id, name, type, channel, usage_count, usage_limit",
      )
      .eq("tenant_id", tenantId)
      .order("priority", { ascending: false }),
    (() => {
      let q = supabase
        .from("invoices")
        .select("promotion_id, total, promotion_discount, promotion_free_value")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .not("promotion_id", "is", null)
        .gte("created_at", range.start)
        .lt("created_at", range.end);
      if (params?.branchId) q = q.eq("branch_id", params.branchId);
      return q;
    })(),
  ]);

  if (promosRes.error) handleError(promosRes.error, "getPromotionDetailRows:promos");
  if (invRes.error) handleError(invRes.error, "getPromotionDetailRows:invoices");

  const promos = (promosRes.data ?? []) as Array<{
    id: string;
    name: string;
    type: Promotion["type"];
    channel: "retail" | "fnb" | "both";
    usage_count: number;
    usage_limit: number | null;
  }>;

  // Aggregate invoices by promotion_id
  const aggMap = new Map<
    string,
    { count: number; discount: number; free: number; revenue: number }
  >();
  for (const inv of (invRes.data ?? []) as Array<{
    promotion_id: string;
    total: number;
    promotion_discount: number;
    promotion_free_value: number;
  }>) {
    const key = inv.promotion_id;
    const cur = aggMap.get(key) ?? { count: 0, discount: 0, free: 0, revenue: 0 };
    cur.count += 1;
    cur.discount += Number(inv.promotion_discount ?? 0);
    cur.free += Number(inv.promotion_free_value ?? 0);
    cur.revenue += Number(inv.total ?? 0);
    aggMap.set(key, cur);
  }

  const rows: PromotionDetailRow[] = promos.map((p) => {
    const agg = aggMap.get(p.id) ?? { count: 0, discount: 0, free: 0, revenue: 0 };
    return {
      promotionId: p.id,
      name: p.name,
      type: p.type,
      channel: p.channel,
      invoiceCount: agg.count,
      totalDiscount: agg.discount,
      totalFreeValue: agg.free,
      totalRevenue: agg.revenue,
      avgDiscountPerInvoice: agg.count > 0 ? Math.round(agg.discount / agg.count) : 0,
      lifetimeUsageCount: p.usage_count ?? 0,
      usageLimit: p.usage_limit ?? null,
    };
  });

  // Sort: promotions có data lên trước, sort theo totalDiscount desc
  rows.sort((a, b) => {
    if (a.invoiceCount === 0 && b.invoiceCount > 0) return 1;
    if (a.invoiceCount > 0 && b.invoiceCount === 0) return -1;
    return b.totalDiscount - a.totalDiscount;
  });

  return rows;
}

// ============================================================
// Daily trend
// ============================================================

/**
 * Lượt dùng + discount theo ngày trong N ngày qua. Dùng cho chart.
 * Day buckets format YYYY-MM-DD (LOCAL).
 */
export async function getPromotionDailyTrend(params?: {
  days?: number;
  branchId?: string;
}): Promise<PromotionDailyPoint[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const days = params?.days ?? 30;
  const range = defaultRange(days);

  let query = supabase
    .from("invoices")
    .select("created_at, promotion_discount")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("promotion_id", "is", null)
    .gte("created_at", range.start)
    .lt("created_at", range.end);
  if (params?.branchId) query = query.eq("branch_id", params.branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getPromotionDailyTrend");

  // Bucketize by date (local)
  const buckets = new Map<string, { usageCount: number; totalDiscount: number }>();
  // Init all days với 0 — UI chart không bị skip ngày trống
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    buckets.set(key, { usageCount: 0, totalDiscount: 0 });
  }

  for (const row of (data ?? []) as Array<{
    created_at: string;
    promotion_discount: number;
  }>) {
    const d = new Date(row.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.usageCount += 1;
    bucket.totalDiscount += Number(row.promotion_discount ?? 0);
  }

  return Array.from(buckets.entries()).map(([date, data]) => ({
    date,
    usageCount: data.usageCount,
    totalDiscount: data.totalDiscount,
  }));
}
