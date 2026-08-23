import { describe, expect, it } from "vitest";
import { getFnbBenefitDisplay } from "@/lib/fnb-benefit-display";

describe("getFnbBenefitDisplay", () => {
  it("keeps manual discount separate from server-validated benefits", () => {
    expect(
      getFnbBenefitDisplay({
        totalAfterManualDiscount: 95_000,
        manualDiscountAmount: 5_000,
        promotionDiscountAmount: 10_000,
        couponDiscountAmount: 15_000,
      }),
    ).toEqual({
      manualDiscountAmount: 5_000,
      promotionDiscountAmount: 10_000,
      couponDiscountAmount: 15_000,
      automaticDiscountAmount: 25_000,
      totalDiscountAmount: 30_000,
      total: 70_000,
    });
  });

  it("never shows a negative payable total from a stale client preview", () => {
    expect(
      getFnbBenefitDisplay({
        totalAfterManualDiscount: 10_000,
        manualDiscountAmount: 0,
        promotionDiscountAmount: 20_000,
        couponDiscountAmount: -1,
      }).total,
    ).toBe(0);
  });
});
