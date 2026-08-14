import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00255_harden_fnb_checkout_benefits.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/fnb-checkout.ts",
  "utf8",
);
const page = readFileSync("src/app/pos/fnb/page.tsx", "utf8");

describe("F&B checkout benefits atomic hardening", () => {
  it("returns an existing paid invoice on a network retry", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("if v_order.invoice_id is not null then");
    expect(migration).toContain("'idempotent', true");
  });

  it("commits promotion, coupon and loyalty with payment", () => {
    expect(migration).toContain("public.fnb_complete_payment_atomic(");
    expect(migration).toContain("public.increment_promotion_usage");
    expect(migration).toContain("public.apply_coupon_atomic");
    expect(migration).toContain("public.earn_loyalty_points");
    expect(migration).toContain("'fnb_checkout_benefits_applied'");
  });

  it("queues all benefit context for online and offline checkout", () => {
    expect(service).toContain('"fnb_complete_payment_atomic_v2"');
    expect(service).toContain("p_promotion_id: input.promotionId");
    expect(service).toContain("p_coupon_code: input.couponCode");
    expect(page).toContain("customerId: tab?.customerId ?? null");
    expect(page).toContain("promotionId: appliedPromotion?.promotion.id");
    expect(page).toContain("couponCode: couponApplied?.code");
    expect(page).toContain("appliedPromotion, couponApplied]");
  });

  it("removes post-payment benefit writes from the page", () => {
    expect(page).not.toContain("await incrementPromotionUsage(");
    expect(page).not.toContain("tagInvoicePromotion({");
    expect(page).not.toContain("applyCouponAtomic({");
    expect(page).not.toContain("earnLoyaltyPoints(");
  });
});
