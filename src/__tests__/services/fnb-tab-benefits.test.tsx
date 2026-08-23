import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFnbTabBenefits } from "@/app/pos/fnb/hooks/use-fnb-tab-benefits";
import type { AppliedPromotion } from "@/lib/services/supabase/promotion-engine";

const PROMOTION_A = {
  promotion: {} as AppliedPromotion["promotion"],
  discountAmount: 10_000,
  eligibleSubtotal: 100_000,
  reasonLabel: "Đơn hợp lệ",
  freeItems: [],
} satisfies AppliedPromotion;

const PROMOTION_B = {
  promotion: {} as AppliedPromotion["promotion"],
  discountAmount: 20_000,
  eligibleSubtotal: 100_000,
  reasonLabel: "Đơn hợp lệ",
  freeItems: [],
} satisfies AppliedPromotion;

describe("useFnbTabBenefits", () => {
  it("keeps coupon and promotion previews with their own POS tab", () => {
    const { result, rerender } = renderHook(
      ({ activeTabId }) => useFnbTabBenefits(activeTabId),
      { initialProps: { activeTabId: "tab-a" as string | null } },
    );

    act(() => {
      result.current.setCouponForTab("tab-a", { code: "A10", discount: 10_000 });
      result.current.setPromotionForTab("tab-a", PROMOTION_A);
    });

    rerender({ activeTabId: "tab-b" });
    expect(result.current.couponApplied).toBeNull();
    expect(result.current.appliedPromotion).toBeNull();

    act(() => {
      result.current.setCouponForTab("tab-b", { code: "B20", discount: 20_000 });
      result.current.setPromotionForTab("tab-b", PROMOTION_B);
    });

    rerender({ activeTabId: "tab-a" });
    expect(result.current.couponApplied).toEqual({ code: "A10", discount: 10_000 });
    expect(result.current.appliedPromotion).toBe(PROMOTION_A);

    rerender({ activeTabId: "tab-b" });
    expect(result.current.couponApplied).toEqual({ code: "B20", discount: 20_000 });
    expect(result.current.appliedPromotion).toBe(PROMOTION_B);
  });

  it("keeps a manual promotion dismissal local to its tab and clears a paid tab", () => {
    const { result, rerender } = renderHook(
      ({ activeTabId }) => useFnbTabBenefits(activeTabId),
      { initialProps: { activeTabId: "tab-a" as string | null } },
    );

    act(() => {
      result.current.setPromotionForTab("tab-a", PROMOTION_A);
      result.current.setPromotionForTab("tab-b", PROMOTION_B);
      result.current.setPromotionClearedForTab("tab-a", true);
    });

    expect(result.current.appliedPromotion).toBeNull();
    expect(result.current.promotionCleared).toBe(true);

    rerender({ activeTabId: "tab-b" });
    expect(result.current.appliedPromotion).toBe(PROMOTION_B);
    expect(result.current.promotionCleared).toBe(false);

    act(() => {
      result.current.clearTabBenefits("tab-a");
    });
    rerender({ activeTabId: "tab-a" });
    expect(result.current.appliedPromotion).toBeNull();
    expect(result.current.promotionCleared).toBe(false);
  });
});
