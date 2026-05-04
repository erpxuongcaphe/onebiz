/**
 * Promotion Engine — Sprint KM-2
 *
 * Pure functions (filter + calculate + select) + async resolver.
 *
 * Public API:
 *   resolveApplicablePromotions(ctx)  — async fetch active + filter applicable
 *   selectBestPromotion(applicable, cart, settings)
 *   calculateDiscount(promo, cart)    — pure
 *   incrementPromotionUsage(promoId)  — atomic, gọi sau checkout thành công
 *
 * Filter chain (filterApplicablePromotions):
 *   1. channel match (promo.channel === ctx.channel || "both")
 *   2. branch match (branchIds rỗng OR contains ctx.branchId)
 *   3. usage check (usageLimit null OR usageCount < usageLimit)
 *   4. min_order_amount <= subtotal
 *   5. time-of-day (cả 2 null OR now in [start, end])
 *   6. day-of-week (rỗng OR contains today)
 *   7. applies_to (all/category/product có line eligible không)
 *
 * Note: is_active + start_date/end_date đã filter ở DB (getActivePromotions).
 * Engine chỉ cần filter các điều kiện cart-specific.
 */

import type { Promotion, PromotionSettings } from "@/lib/types";
import { getClient, handleError, getCurrentTenantId } from "./base";
import { getActivePromotions, getPromotionSettings } from "./promotions";
import { formatCurrency } from "@/lib/format";

// ============================================================
// Types
// ============================================================

export interface PromotionCartItem {
  productId: string;
  /** Product category ID — null nếu SP chưa phân loại */
  categoryId?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface PromotionContext {
  channel: "retail" | "fnb";
  branchId: string;
  customerId?: string | null;
  items: PromotionCartItem[];
  /** Override now for time-based testing. Default new Date() */
  now?: Date;
}

/**
 * 1 món được tặng kèm theo promotion (BOGO hoặc gift).
 * POS sẽ render line "Tặng" trong cart + invoice + receipt.
 */
export interface PromotionFreeItem {
  productId: string;
  /** Hiển thị trong cart/receipt. Nếu engine không biết name → empty, POS sẽ
   *  lookup từ products list theo productId. */
  productName?: string;
  /** SL tặng. BOGO: 1 unit / set × buy_quantity (gộp lại nếu cùng productId). */
  quantity: number;
  /** Đơn giá gốc — dùng để hiển thị "trị giá Xđ, tặng" trên receipt. */
  unitPrice: number;
}

export interface AppliedPromotion {
  promotion: Promotion;
  /** Số tiền discount tính ra (luôn >= 0). Với BOGO/gift = sum(freeItems.qty * unitPrice). */
  discountAmount: number;
  /** Subtotal của các line eligible (sau khi filter applies_to) */
  eligibleSubtotal: number;
  /** Lý do hiển thị cho UI: "Giảm 10%", "Đơn -50.000đ", "Mua 2 tặng 1" */
  reasonLabel: string;
  /**
   * KM-3: danh sách quà tặng cụ thể (chỉ cho BOGO + gift).
   * - BOGO: pick các unit rẻ nhất từ eligible items theo công thức
   *         sets × getQuantity (rounded down).
   * - gift: 1 unit cho mỗi productId trong gift_product_ids.
   * - discount_percent / discount_fixed: undefined (không có quà).
   */
  freeItems?: PromotionFreeItem[];
}

// ============================================================
// Pure helpers
// ============================================================

/** Tính subtotal đầy đủ (chưa filter applies_to). */
export function calculateSubtotal(items: PromotionCartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

/**
 * Lọc các line eligible theo applies_to + appliesToIds:
 *   - "all"       → tất cả
 *   - "category"  → line.categoryId trong appliesToIds
 *   - "product"   → line.productId trong appliesToIds
 */
export function filterEligibleItems(
  promo: Promotion,
  items: PromotionCartItem[],
): PromotionCartItem[] {
  if (promo.appliesTo === "all") return items;
  const ids = new Set(promo.appliesToIds);
  if (promo.appliesTo === "category") {
    return items.filter((it) => it.categoryId && ids.has(it.categoryId));
  }
  if (promo.appliesTo === "product") {
    return items.filter((it) => ids.has(it.productId));
  }
  return [];
}

/** "HH:mm:ss" → minutes since 00:00. null → null. */
function timeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** Now (Date) → minutes since 00:00 LOCAL time */
function nowToMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Check time-of-day window. Cả 2 null → áp cả ngày.
 * timeStart < timeEnd: window thường (vd 14:00-17:00)
 * timeStart > timeEnd: window cross-midnight (vd 22:00-02:00) — hiếm cho KM cafe
 */
export function isWithinTimeWindow(
  timeStart: string | null,
  timeEnd: string | null,
  now: Date,
): boolean {
  const startMin = timeToMinutes(timeStart);
  const endMin = timeToMinutes(timeEnd);
  if (startMin === null || endMin === null) return true; // áp cả ngày
  const nowMin = nowToMinutes(now);
  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin <= endMin;
  }
  // cross-midnight (start > end)
  return nowMin >= startMin || nowMin <= endMin;
}

/** Check day-of-week. Rỗng → áp mọi ngày. */
export function isWithinDayOfWeek(daysOfWeek: number[], now: Date): boolean {
  if (!daysOfWeek || daysOfWeek.length === 0) return true;
  return daysOfWeek.includes(now.getDay());
}

// ============================================================
// Filter applicable
// ============================================================

/**
 * Pure filter — KM nào có thể áp với cart hiện tại.
 *
 * Pre-condition: promotions đã filter `is_active=true` + `start_date <= now <=
 * end_date` ở DB level. Engine chỉ filter các điều kiện cart-specific.
 */
export function filterApplicablePromotions(
  promotions: Promotion[],
  ctx: PromotionContext,
): Promotion[] {
  const now = ctx.now ?? new Date();
  const subtotal = calculateSubtotal(ctx.items);

  return promotions.filter((promo) => {
    // 1. channel match
    if (promo.channel !== "both" && promo.channel !== ctx.channel) return false;

    // 2. branch match — branchIds rỗng = áp toàn chuỗi
    if (promo.branchIds.length > 0 && !promo.branchIds.includes(ctx.branchId)) {
      return false;
    }

    // 3. usage check
    if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
      return false;
    }

    // 4. min order
    if (subtotal < promo.minOrderAmount) return false;

    // 5. time-of-day
    if (!isWithinTimeWindow(promo.timeStart, promo.timeEnd, now)) return false;

    // 6. day-of-week
    if (!isWithinDayOfWeek(promo.daysOfWeek, now)) return false;

    // 7. applies_to → cần có ít nhất 1 line eligible
    const eligible = filterEligibleItems(promo, ctx.items);
    if (eligible.length === 0) return false;

    // BOGO cần đủ qty mua X
    if (promo.type === "buy_x_get_y") {
      const totalQty = eligible.reduce((s, it) => s + it.quantity, 0);
      const required = promo.buyQuantity ?? 0;
      if (required <= 0 || totalQty < required) return false;
    }

    return true;
  });
}

// ============================================================
// Calculate discount
// ============================================================

/**
 * Tính discount cho 1 promotion áp vào cart.
 *
 * Returns AppliedPromotion với:
 *   - discountAmount: VND giảm (>= 0)
 *   - eligibleSubtotal: subtotal sau filter applies_to
 *   - reasonLabel: chuỗi hiển thị UI
 *
 * BOGO + gift trả discount ước lượng cho KM-2 (sẽ refine ở KM-3
 * khi build full BOGO engine + free items output).
 */
export function calculateDiscount(
  promo: Promotion,
  ctx: PromotionContext,
): AppliedPromotion {
  const eligible = filterEligibleItems(promo, ctx.items);
  const eligibleSubtotal = calculateSubtotal(eligible);

  let discountAmount = 0;
  let reasonLabel = promo.name;
  let freeItems: PromotionFreeItem[] | undefined;

  switch (promo.type) {
    case "discount_percent": {
      discountAmount = Math.round((eligibleSubtotal * promo.value) / 100);
      reasonLabel = `Giảm ${promo.value}%`;
      break;
    }
    case "discount_fixed": {
      discountAmount = Math.min(promo.value, eligibleSubtotal);
      reasonLabel = `Giảm ${formatCurrency(promo.value)}đ`;
      break;
    }
    case "buy_x_get_y": {
      // KM-3: pick các unit RẺ NHẤT làm free items, group theo productId.
      //   sets = floor(totalEligibleQty / buyQty)
      //   freeUnits cần = sets × getQty
      //   Distribute: expand eligible items thành flat unit list, sort
      //   ascending by unitPrice, pick freeUnits đầu tiên, group lại theo
      //   productId. discountAmount = sum(freeItems.qty × unitPrice).
      const buyQty = promo.buyQuantity ?? 0;
      const getQty = promo.getQuantity ?? 0;
      if (buyQty > 0 && getQty > 0 && eligible.length > 0) {
        const totalEligibleQty = eligible.reduce((s, it) => s + it.quantity, 0);
        const sets = Math.floor(totalEligibleQty / buyQty);
        const freeUnitsNeeded = sets * getQty;
        if (freeUnitsNeeded > 0) {
          // Expand thành flat unit list rồi sort theo unitPrice asc — pick rẻ nhất
          // làm quà. Đây là logic chuẩn KiotViet/Sapo.
          const flatUnits: { productId: string; unitPrice: number }[] = [];
          for (const item of eligible) {
            for (let i = 0; i < item.quantity; i++) {
              flatUnits.push({ productId: item.productId, unitPrice: item.unitPrice });
            }
          }
          flatUnits.sort((a, b) => a.unitPrice - b.unitPrice);
          const picked = flatUnits.slice(0, freeUnitsNeeded);

          // Group by productId
          const groupMap = new Map<string, PromotionFreeItem>();
          for (const u of picked) {
            const existing = groupMap.get(u.productId);
            if (existing) {
              existing.quantity += 1;
            } else {
              groupMap.set(u.productId, {
                productId: u.productId,
                quantity: 1,
                unitPrice: u.unitPrice,
              });
            }
          }
          freeItems = Array.from(groupMap.values());
          discountAmount = freeItems.reduce((s, f) => s + f.quantity * f.unitPrice, 0);
        }
      }
      reasonLabel = `Mua ${buyQty} tặng ${getQty}`;
      break;
    }
    case "gift": {
      // KM-3: output free items từ promotion.giftProductIds.
      // Mỗi productId = 1 unit tặng. Engine không biết unitPrice của gift
      // products (không có trong cart) → set unitPrice = 0, POS sẽ lookup
      // từ products list để hiển thị "trị giá Xđ" trên receipt.
      // discountAmount = 0 (gift không phải money discount, là physical item).
      if (promo.giftProductIds && promo.giftProductIds.length > 0) {
        freeItems = promo.giftProductIds.map((productId) => ({
          productId,
          quantity: 1,
          unitPrice: 0,
        }));
      }
      discountAmount = 0;
      reasonLabel =
        freeItems && freeItems.length > 0
          ? `Tặng ${freeItems.length} món`
          : "Tặng quà kèm";
      break;
    }
  }

  return { promotion: promo, discountAmount, eligibleSubtotal, reasonLabel, freeItems };
}

// ============================================================
// Select best
// ============================================================

/**
 * Estimated value của 1 AppliedPromotion để compare khi select best:
 *   - discount_percent / discount_fixed / BOGO: discountAmount
 *   - gift: tổng (quantity × unitPrice) của freeItems — nhưng engine không
 *     có unitPrice (set 0 ở calculateDiscount). Để gift vẫn có thể được
 *     pick, giá trị estimate = 1 (tượng trưng "có giá trị nào đó").
 *     Khi 2 KM ngang nhau → priority quyết định.
 *   POS có thể override priority để force gift được áp dụng.
 */
function estimatePromotionValue(applied: AppliedPromotion): number {
  if (applied.discountAmount > 0) return applied.discountAmount;
  if (applied.freeItems && applied.freeItems.length > 0) {
    // Gift: estimate = sum unitPrice nếu engine có (KM-2 BOGO), hoặc 1 nếu không
    const sum = applied.freeItems.reduce((s, f) => s + f.quantity * f.unitPrice, 0);
    return sum > 0 ? sum : 1;
  }
  return 0;
}

/**
 * Chọn KM tốt nhất từ list applicable.
 *
 * Logic:
 *   - Nếu settings.autoApplyBest = false → trả null (cashier tự chọn — UI sẽ
 *     hiển thị danh sách applicable cho user click).
 *   - Tính discount cho từng applicable
 *   - Filter ra KM có giá trị > 0 (discount tiền HOẶC có freeItems)
 *   - Sort theo: priority desc → estimatedValue desc
 *   - Pick first
 *
 * Trường hợp tie: KM có priority cao hơn thắng (admin chỉ định ưu tiên).
 */
export function selectBestPromotion(
  applicable: Promotion[],
  ctx: PromotionContext,
  autoApplyBest: boolean = true,
): AppliedPromotion | null {
  if (applicable.length === 0) return null;
  if (!autoApplyBest) return null;

  const calculated = applicable
    .map((p) => calculateDiscount(p, ctx))
    .filter((c) => estimatePromotionValue(c) > 0);

  if (calculated.length === 0) return null;

  calculated.sort((a, b) => {
    if (a.promotion.priority !== b.promotion.priority) {
      return b.promotion.priority - a.promotion.priority;
    }
    return estimatePromotionValue(b) - estimatePromotionValue(a);
  });

  return calculated[0];
}

// ============================================================
// Async resolver — public API for POS
// ============================================================

/**
 * Resolve KM tốt nhất cho cart hiện tại. Wraps:
 *   1. getActivePromotions() — fetch DB
 *   2. getPromotionSettings() — đọc autoApplyBest
 *   3. filterApplicablePromotions(promos, ctx)
 *   4. selectBestPromotion(applicable, ctx, settings.autoApplyBest)
 *
 * Trả null nếu cart rỗng hoặc không có KM phù hợp.
 *
 * POS gọi function này trong useEffect khi cart hoặc branch/customer đổi.
 */
export async function resolveAppliedPromotion(
  ctx: PromotionContext,
): Promise<{
  best: AppliedPromotion | null;
  applicable: Promotion[];
  settings: PromotionSettings;
}> {
  if (ctx.items.length === 0) {
    const settings = await getPromotionSettings();
    return { best: null, applicable: [], settings };
  }

  const [promotions, settings] = await Promise.all([
    getActivePromotions(),
    getPromotionSettings(),
  ]);

  const applicable = filterApplicablePromotions(promotions, ctx);
  const best = selectBestPromotion(applicable, ctx, settings.autoApplyBest);

  return { best, applicable, settings };
}

// ============================================================
// Atomic usage increment
// ============================================================

/**
 * Tăng usage_count của promotion sau khi POS checkout thành công.
 *
 * Gọi RPC `increment_promotion_usage` (00042) — atomic, raise exception
 * nếu vượt usage_limit để tránh double-count khi 2 cashier cùng checkout.
 *
 * Trả về new usage_count. Lỗi → throw (caller decide).
 */
export async function incrementPromotionUsage(promotionId: string): Promise<number> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  void tenantId; // RPC dùng get_user_tenant_id() server-side

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "increment_promotion_usage",
    { p_promotion_id: promotionId },
  );

  if (error) handleError(error, "incrementPromotionUsage");
  return data as number;
}
