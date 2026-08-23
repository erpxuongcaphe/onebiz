import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00343_fnb_payment_benefits_server_authority.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/fnb-checkout.ts",
  "utf8",
);
const page = readFileSync("src/app/pos/fnb/page.tsx", "utf8");

describe("F&B payment benefit authority", () => {
  it("adds a new server-authoritative endpoint without changing the active V2 endpoint", () => {
    expect(migration).toContain("public.fnb_complete_payment_atomic_v3");
    expect(migration).not.toContain("revoke all on function public.fnb_complete_payment_atomic_v2");
  });

  it("calculates promotion and coupon values inside the payment transaction", () => {
    expect(migration).toContain("v_promotion_discount");
    expect(migration).toContain("v_coupon_discount");
    expect(migration).toContain("FNB_PROMOTION_TYPE_NOT_SUPPORTED");
    expect(migration).toContain("when 'buy_x_get_y' then");
    expect(migration).toContain("generate_series(");
    expect(migration).toContain("FNB_COUPON_TYPE_INVALID");
    expect(migration).toContain("public.increment_promotion_usage");
    expect(migration).toContain("public.apply_coupon_atomic");
  });

  it("does not expose client-calculated automatic benefit fields in the browser RPC", () => {
    expect(service).toContain('"fnb_complete_payment_atomic_v3"');
    expect(service).not.toContain("p_promotion_discount");
    expect(service).not.toContain("p_coupon_discount");
    // Param values, including stale OTP removal, are tested through the
    // fnbPayment wrapper's observable RPC payload in fnb-checkout.test.ts.
  });

  it("does not fold automatic promotion or coupon values into the OTP-gated manual discount", () => {
    expect(page).not.toContain("pos.setOrderDiscount(best.discountAmount)");
    expect(page).not.toContain("pos.setOrderDiscount(result.discount)");
    expect(page).toContain("manualDiscountAmount: pos.orderDiscountAmount");
    expect(page).toContain("promotionId: appliedPromotion?.promotion.id");
    expect(page).toContain("couponCode: couponApplied?.code");
  });

  it("does not reinterpret a legacy combined discount as a manual discount", () => {
    expect(service).toContain("Đơn offline cũ có giảm giá");
    expect(service).not.toContain("input.manualDiscountAmount ?? input.discountAmount");
  });

  it("requires server-side OTP verification and keeps the split-table guard", () => {
    expect(migration).toContain("public.verify_otp_authorization(");
    expect(migration).toContain("FNB_MANUAL_DISCOUNT_OTP_REQUIRED");
    expect(migration).toContain("current_order_id = v_next_order_id");
  });
});
