/**
 * Promotion Engine — Sprint KM-2 unit tests
 *
 * Test pure functions:
 *   - calculateSubtotal
 *   - filterEligibleItems
 *   - isWithinTimeWindow
 *   - isWithinDayOfWeek
 *   - filterApplicablePromotions (filter chain)
 *   - calculateDiscount (per type)
 *   - selectBestPromotion (priority + discount sort)
 */

import { describe, it, expect } from "vitest";
import {
  calculateSubtotal,
  filterEligibleItems,
  isWithinTimeWindow,
  isWithinDayOfWeek,
  filterApplicablePromotions,
  calculateDiscount,
  selectBestPromotion,
  type PromotionContext,
  type PromotionCartItem,
} from "@/lib/services/supabase/promotion-engine";
import type { Promotion } from "@/lib/types";

// ============================================================
// Fixtures
// ============================================================

function makePromo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: "p1",
    name: "Test KM",
    description: null,
    type: "discount_percent",
    value: 10,
    minOrderAmount: 0,
    buyQuantity: null,
    getQuantity: null,
    appliesTo: "all",
    appliesToIds: [],
    startDate: "2025-01-01T00:00:00.000Z",
    endDate: "2026-12-31T23:59:59.000Z",
    isActive: true,
    autoApply: true,
    priority: 0,
    channel: "both",
    branchIds: [],
    usageLimit: null,
    usageCount: 0,
    timeStart: null,
    timeEnd: null,
    daysOfWeek: [],
    giftProductIds: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeItem(overrides: Partial<PromotionCartItem> = {}): PromotionCartItem {
  return {
    productId: "prod-1",
    categoryId: "cat-1",
    quantity: 2,
    unitPrice: 50000,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PromotionContext> = {}): PromotionContext {
  return {
    channel: "retail",
    branchId: "branch-1",
    customerId: null,
    items: [makeItem()],
    ...overrides,
  };
}

// ============================================================
// calculateSubtotal
// ============================================================

describe("calculateSubtotal", () => {
  it("sums quantity × unitPrice", () => {
    expect(
      calculateSubtotal([
        { productId: "p1", quantity: 2, unitPrice: 50000 },
        { productId: "p2", quantity: 3, unitPrice: 100000 },
      ]),
    ).toBe(2 * 50000 + 3 * 100000);
  });

  it("returns 0 for empty cart", () => {
    expect(calculateSubtotal([])).toBe(0);
  });
});

// ============================================================
// filterEligibleItems
// ============================================================

describe("filterEligibleItems", () => {
  const items = [
    { productId: "p1", categoryId: "cat-1", quantity: 1, unitPrice: 100 },
    { productId: "p2", categoryId: "cat-2", quantity: 1, unitPrice: 200 },
    { productId: "p3", categoryId: null, quantity: 1, unitPrice: 300 },
  ];

  it("appliesTo='all' → return all items", () => {
    const promo = makePromo({ appliesTo: "all" });
    expect(filterEligibleItems(promo, items)).toHaveLength(3);
  });

  it("appliesTo='category' → filter by categoryId", () => {
    const promo = makePromo({ appliesTo: "category", appliesToIds: ["cat-1"] });
    const result = filterEligibleItems(promo, items);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("p1");
  });

  it("appliesTo='category' skips items with null categoryId", () => {
    const promo = makePromo({ appliesTo: "category", appliesToIds: ["cat-1"] });
    expect(filterEligibleItems(promo, items)).not.toContain(items[2]);
  });

  it("appliesTo='product' → filter by productId", () => {
    const promo = makePromo({ appliesTo: "product", appliesToIds: ["p2", "p3"] });
    const result = filterEligibleItems(promo, items);
    expect(result.map((i) => i.productId)).toEqual(["p2", "p3"]);
  });
});

// ============================================================
// isWithinTimeWindow
// ============================================================

describe("isWithinTimeWindow", () => {
  function dateAt(h: number, m: number = 0): Date {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  it("both null → áp cả ngày", () => {
    expect(isWithinTimeWindow(null, null, dateAt(3))).toBe(true);
    expect(isWithinTimeWindow(null, null, dateAt(23))).toBe(true);
  });

  it("normal window 14:00-17:00", () => {
    expect(isWithinTimeWindow("14:00:00", "17:00:00", dateAt(15))).toBe(true);
    expect(isWithinTimeWindow("14:00:00", "17:00:00", dateAt(14))).toBe(true);
    expect(isWithinTimeWindow("14:00:00", "17:00:00", dateAt(17))).toBe(true);
    expect(isWithinTimeWindow("14:00:00", "17:00:00", dateAt(13, 59))).toBe(false);
    expect(isWithinTimeWindow("14:00:00", "17:00:00", dateAt(17, 1))).toBe(false);
  });

  it("cross-midnight 22:00-02:00", () => {
    expect(isWithinTimeWindow("22:00:00", "02:00:00", dateAt(23))).toBe(true);
    expect(isWithinTimeWindow("22:00:00", "02:00:00", dateAt(1))).toBe(true);
    expect(isWithinTimeWindow("22:00:00", "02:00:00", dateAt(12))).toBe(false);
  });
});

// ============================================================
// isWithinDayOfWeek
// ============================================================

describe("isWithinDayOfWeek", () => {
  it("rỗng → áp mọi ngày", () => {
    const d = new Date();
    expect(isWithinDayOfWeek([], d)).toBe(true);
  });

  it("contains today → true", () => {
    const d = new Date();
    expect(isWithinDayOfWeek([d.getDay()], d)).toBe(true);
  });

  it("không contains → false", () => {
    const d = new Date();
    const otherDay = (d.getDay() + 1) % 7;
    expect(isWithinDayOfWeek([otherDay], d)).toBe(false);
  });
});

// ============================================================
// filterApplicablePromotions — filter chain
// ============================================================

describe("filterApplicablePromotions", () => {
  it("keeps promo with all conditions met", () => {
    const promo = makePromo();
    const ctx = makeCtx();
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(1);
  });

  it("rejects when channel mismatch", () => {
    const promo = makePromo({ channel: "fnb" });
    const ctx = makeCtx({ channel: "retail" });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(0);
  });

  it("accepts channel='both' for any channel", () => {
    const promo = makePromo({ channel: "both" });
    expect(
      filterApplicablePromotions([promo], makeCtx({ channel: "retail" })),
    ).toHaveLength(1);
    expect(
      filterApplicablePromotions([promo], makeCtx({ channel: "fnb" })),
    ).toHaveLength(1);
  });

  it("rejects when branchIds set & doesn't include current", () => {
    const promo = makePromo({ branchIds: ["branch-2", "branch-3"] });
    const ctx = makeCtx({ branchId: "branch-1" });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(0);
  });

  it("accepts when branchIds rỗng (toàn chuỗi)", () => {
    const promo = makePromo({ branchIds: [] });
    expect(filterApplicablePromotions([promo], makeCtx())).toHaveLength(1);
  });

  it("accepts when branchIds includes current branch", () => {
    const promo = makePromo({ branchIds: ["branch-1", "branch-2"] });
    const ctx = makeCtx({ branchId: "branch-1" });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(1);
  });

  it("rejects when usage_count >= usage_limit", () => {
    const promo = makePromo({ usageLimit: 100, usageCount: 100 });
    expect(filterApplicablePromotions([promo], makeCtx())).toHaveLength(0);
  });

  it("accepts when usage_count < usage_limit", () => {
    const promo = makePromo({ usageLimit: 100, usageCount: 99 });
    expect(filterApplicablePromotions([promo], makeCtx())).toHaveLength(1);
  });

  it("accepts when usage_limit null (unlimited)", () => {
    const promo = makePromo({ usageLimit: null, usageCount: 1000000 });
    expect(filterApplicablePromotions([promo], makeCtx())).toHaveLength(1);
  });

  it("rejects when subtotal < min_order_amount", () => {
    const promo = makePromo({ minOrderAmount: 200000 });
    const ctx = makeCtx({ items: [makeItem({ quantity: 1, unitPrice: 50000 })] });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(0);
  });

  it("accepts when subtotal >= min_order_amount", () => {
    const promo = makePromo({ minOrderAmount: 50000 });
    const ctx = makeCtx({ items: [makeItem({ quantity: 1, unitPrice: 50000 })] });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(1);
  });

  it("rejects BOGO when totalQty < buyQuantity", () => {
    const promo = makePromo({
      type: "buy_x_get_y",
      buyQuantity: 5,
      getQuantity: 1,
    });
    const ctx = makeCtx({ items: [makeItem({ quantity: 2 })] });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(0);
  });

  it("accepts BOGO when totalQty >= buyQuantity", () => {
    const promo = makePromo({
      type: "buy_x_get_y",
      buyQuantity: 2,
      getQuantity: 1,
    });
    const ctx = makeCtx({ items: [makeItem({ quantity: 3 })] });
    expect(filterApplicablePromotions([promo], ctx)).toHaveLength(1);
  });

  it("rejects when no eligible items (applies_to category mismatch)", () => {
    const promo = makePromo({
      appliesTo: "category",
      appliesToIds: ["cat-other"],
    });
    expect(filterApplicablePromotions([promo], makeCtx())).toHaveLength(0);
  });
});

// ============================================================
// calculateDiscount
// ============================================================

describe("calculateDiscount", () => {
  it("discount_percent → subtotal * value/100", () => {
    const promo = makePromo({ type: "discount_percent", value: 10 });
    const ctx = makeCtx({
      items: [makeItem({ quantity: 2, unitPrice: 50000 })],
    });
    const result = calculateDiscount(promo, ctx);
    expect(result.discountAmount).toBe(10000); // 10% of 100k
    expect(result.reasonLabel).toBe("Giảm 10%");
  });

  it("discount_fixed → min(value, eligibleSubtotal)", () => {
    const promo = makePromo({ type: "discount_fixed", value: 30000 });
    const ctx = makeCtx({
      items: [makeItem({ quantity: 1, unitPrice: 50000 })],
    });
    expect(calculateDiscount(promo, ctx).discountAmount).toBe(30000);
  });

  it("discount_fixed cap khi value > subtotal", () => {
    const promo = makePromo({ type: "discount_fixed", value: 100000 });
    const ctx = makeCtx({
      items: [makeItem({ quantity: 1, unitPrice: 50000 })],
    });
    expect(calculateDiscount(promo, ctx).discountAmount).toBe(50000);
  });

  it("buy_x_get_y → sets * getQty * cheapest unit", () => {
    // Mua 2 tặng 1, có 5 món rẻ nhất 30k
    const promo = makePromo({
      type: "buy_x_get_y",
      buyQuantity: 2,
      getQuantity: 1,
    });
    const ctx = makeCtx({
      items: [
        makeItem({ productId: "p1", quantity: 3, unitPrice: 50000 }),
        makeItem({ productId: "p2", categoryId: "cat-1", quantity: 2, unitPrice: 30000 }),
      ],
    });
    // total qty = 5, sets = floor(5/2) = 2, getQty = 1 → 2 free units
    // pick rẻ nhất: 2 unit × 30000 = 60000
    expect(calculateDiscount(promo, ctx).discountAmount).toBe(60000);
  });

  it("KM-3: BOGO output free items list (group by productId)", () => {
    const promo = makePromo({
      type: "buy_x_get_y",
      buyQuantity: 2,
      getQuantity: 1,
    });
    const ctx = makeCtx({
      items: [
        makeItem({ productId: "p1", quantity: 3, unitPrice: 50000 }),
        makeItem({ productId: "p2", categoryId: "cat-1", quantity: 2, unitPrice: 30000 }),
      ],
    });
    // Total qty = 5, sets = 2, free units = 2 — pick 2 unit p2 (30000)
    const result = calculateDiscount(promo, ctx);
    expect(result.freeItems).toEqual([
      { productId: "p2", quantity: 2, unitPrice: 30000 },
    ]);
    expect(result.discountAmount).toBe(60000);
  });

  it("KM-3: BOGO free items spans multiple products khi cần", () => {
    const promo = makePromo({
      type: "buy_x_get_y",
      buyQuantity: 1,
      getQuantity: 1,
    });
    // 4 SP qty=1 mỗi: p1=50k, p2=30k, p3=40k, p4=80k
    // sets=4, free=4 units — pick TẤT CẢ vì cần 4
    // Nhưng có 4 unit, pick all → group: each productId × 1
    const ctx = makeCtx({
      items: [
        makeItem({ productId: "p1", quantity: 1, unitPrice: 50000 }),
        makeItem({ productId: "p2", quantity: 1, unitPrice: 30000 }),
        makeItem({ productId: "p3", quantity: 1, unitPrice: 40000 }),
        makeItem({ productId: "p4", quantity: 1, unitPrice: 80000 }),
      ],
    });
    const result = calculateDiscount(promo, ctx);
    expect(result.freeItems).toHaveLength(4);
    // Discount = sum tất cả vì pick all
    expect(result.discountAmount).toBe(50000 + 30000 + 40000 + 80000);
  });

  it("gift type → discount = 0 + freeItems từ giftProductIds", () => {
    const promo = makePromo({
      type: "gift",
      giftProductIds: ["gift-1", "gift-2"],
    });
    const result = calculateDiscount(promo, makeCtx());
    expect(result.discountAmount).toBe(0);
    expect(result.freeItems).toEqual([
      { productId: "gift-1", quantity: 1, unitPrice: 0 },
      { productId: "gift-2", quantity: 1, unitPrice: 0 },
    ]);
    expect(result.reasonLabel).toBe("Tặng 2 món");
  });

  it("gift với giftProductIds rỗng → freeItems undefined", () => {
    const promo = makePromo({ type: "gift", giftProductIds: [] });
    const result = calculateDiscount(promo, makeCtx());
    expect(result.freeItems).toBeUndefined();
    expect(result.reasonLabel).toBe("Tặng quà kèm");
  });

  it("eligible items respect appliesTo filter", () => {
    const promo = makePromo({
      type: "discount_percent",
      value: 10,
      appliesTo: "category",
      appliesToIds: ["cat-target"],
    });
    const ctx = makeCtx({
      items: [
        makeItem({ productId: "p1", categoryId: "cat-target", quantity: 1, unitPrice: 100000 }),
        makeItem({ productId: "p2", categoryId: "cat-other", quantity: 1, unitPrice: 200000 }),
      ],
    });
    // Chỉ giảm trên SP cat-target (100k) → 10% = 10000
    expect(calculateDiscount(promo, ctx).discountAmount).toBe(10000);
  });
});

// ============================================================
// selectBestPromotion
// ============================================================

describe("selectBestPromotion", () => {
  it("returns null khi empty applicable", () => {
    expect(selectBestPromotion([], makeCtx())).toBeNull();
  });

  it("returns null khi autoApplyBest=false", () => {
    const promo = makePromo();
    expect(selectBestPromotion([promo], makeCtx(), false)).toBeNull();
  });

  it("picks highest discount khi same priority", () => {
    const promo10 = makePromo({ id: "p10", value: 10 }); // 10% of 100k = 10000
    const promo20 = makePromo({ id: "p20", value: 20 }); // 20% = 20000
    const ctx = makeCtx({
      items: [makeItem({ quantity: 1, unitPrice: 100000 })],
    });
    const best = selectBestPromotion([promo10, promo20], ctx);
    expect(best?.promotion.id).toBe("p20");
    expect(best?.discountAmount).toBe(20000);
  });

  it("priority cao thắng dù discount thấp hơn", () => {
    const promoLowPriority = makePromo({ id: "p1", value: 30, priority: 0 });
    const promoHighPriority = makePromo({ id: "p2", value: 10, priority: 100 });
    const ctx = makeCtx({
      items: [makeItem({ quantity: 1, unitPrice: 100000 })],
    });
    const best = selectBestPromotion([promoLowPriority, promoHighPriority], ctx);
    expect(best?.promotion.id).toBe("p2");
  });

  it("filter promo có discount = 0 (vd gift không có giftProductIds)", () => {
    const giftPromo = makePromo({ id: "gift", type: "gift", giftProductIds: [] });
    const percentPromo = makePromo({ id: "pct", type: "discount_percent", value: 5 });
    const ctx = makeCtx({
      items: [makeItem({ quantity: 1, unitPrice: 100000 })],
    });
    const best = selectBestPromotion([giftPromo, percentPromo], ctx);
    expect(best?.promotion.id).toBe("pct");
  });

  it("KM-3: gift với giftProductIds + priority cao hơn → vẫn được pick dù discount = 0", () => {
    const giftPromo = makePromo({
      id: "gift",
      type: "gift",
      priority: 100,
      giftProductIds: ["gift-1"],
    });
    const percentPromo = makePromo({
      id: "pct",
      type: "discount_percent",
      value: 5,
      priority: 0,
    });
    const ctx = makeCtx({
      items: [makeItem({ quantity: 1, unitPrice: 100000 })],
    });
    // Gift có priority 100 > pct 0 → pick gift dù discount=0
    const best = selectBestPromotion([giftPromo, percentPromo], ctx);
    expect(best?.promotion.id).toBe("gift");
    expect(best?.freeItems).toHaveLength(1);
  });
});
