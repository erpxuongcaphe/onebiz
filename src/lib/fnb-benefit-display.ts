/**
 * F&B keeps manual discounts in the POS tab state, while promotions and
 * coupons are recalculated by the checkout RPC. This small pure helper makes
 * the client preview explicit without turning those automatic benefits into a
 * client-authoritative payment amount.
 */
export interface FnbBenefitDisplayInput {
  /** Total already reflects the manual tab discount. */
  totalAfterManualDiscount: number;
  manualDiscountAmount: number;
  /** Giảm giá đã được máy chủ lưu cùng đơn bếp, ví dụ sau tách bill. */
  persistedOrderDiscountAmount?: number;
  promotionDiscountAmount?: number;
  couponDiscountAmount?: number;
}

export interface FnbBenefitDisplay {
  manualDiscountAmount: number;
  persistedOrderDiscountAmount: number;
  promotionDiscountAmount: number;
  couponDiscountAmount: number;
  automaticDiscountAmount: number;
  totalDiscountAmount: number;
  total: number;
}

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value ?? 0 : 0;
}

export function getFnbBenefitDisplay({
  totalAfterManualDiscount,
  manualDiscountAmount,
  persistedOrderDiscountAmount,
  promotionDiscountAmount,
  couponDiscountAmount,
}: FnbBenefitDisplayInput): FnbBenefitDisplay {
  const manual = nonNegative(manualDiscountAmount);
  const persisted = nonNegative(persistedOrderDiscountAmount);
  const promotion = nonNegative(promotionDiscountAmount);
  const coupon = nonNegative(couponDiscountAmount);
  const automatic = promotion + coupon;

  return {
    manualDiscountAmount: manual,
    persistedOrderDiscountAmount: persisted,
    promotionDiscountAmount: promotion,
    couponDiscountAmount: coupon,
    automaticDiscountAmount: automatic,
    totalDiscountAmount: manual + persisted + automatic,
    total: Math.max(0, nonNegative(totalAfterManualDiscount) - persisted - automatic),
  };
}
