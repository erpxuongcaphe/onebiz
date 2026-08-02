import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00253_harden_retail_pos_pricing.sql",
  "utf8",
);
const checkoutService = readFileSync(
  "src/lib/services/supabase/pos-checkout.ts",
  "utf8",
);
const orderService = readFileSync(
  "src/lib/services/supabase/orders.ts",
  "utf8",
);
const posPage = readFileSync("src/app/pos/page.tsx", "utf8");

describe("Retail POS pricing hardening", () => {
  it("derives actor, tenant, customer and catalog data on the server", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("public.get_user_tenant_id()");
    expect(migration).toContain("pos_retail.checkout");
    expect(migration).toContain("public.user_has_branch_access");
    expect(migration).toContain("from public.products p");
    expect(migration).toContain("from public.product_variants pv");
    expect(migration).toContain("from public.price_tier_items pti");
    expect(migration).toContain("POS_PRICE_CHANGED");
  });

  it("recalculates discounts, VAT and final total before creating an invoice", () => {
    expect(migration).toContain("v_after_line_discount");
    expect(migration).toContain("v_discount_scale");
    expect(migration).toContain("v_order_vat_amount");
    expect(migration).toContain("'total', v_total");
    expect(migration).toContain("coalesce(p_paid, 0) > v_total + 0.01");
    expect(migration).toContain("POS_PAYMENT_BREAKDOWN_MISMATCH");
  });

  it("requires retail OTP for manual discounts and validates automatic benefits", () => {
    expect(migration).toContain("'pos_retail.discount_override'");
    expect(migration).toContain("'pos_retail.discount'");
    expect(migration).toContain("public.verify_otp_authorization");
    expect(migration).toContain("public.validate_coupon");
    expect(migration).toContain("public.increment_promotion_usage");
    expect(migration).toContain("public.redeem_loyalty_points");
    expect(migration).toContain("public.earn_loyalty_points");
  });

  it("uses hardened RPCs for both fresh and resumed draft checkout", () => {
    expect(checkoutService).toContain('"pos_complete_checkout_atomic_v3"');
    expect(checkoutService).not.toContain("p_subtotal: input.subtotal");
    expect(checkoutService).not.toContain("p_total: input.total");
    expect(checkoutService).not.toContain("p_customer_name:");

    const completeDraftSection = orderService.slice(
      orderService.indexOf("export async function completeDraftOrder"),
      orderService.indexOf("// Delete draft"),
    );
    expect(completeDraftSection).toContain('"complete_draft_atomic_v5"');
    expect(completeDraftSection).toContain("p_items: payment.items");
    expect(completeDraftSection).toContain("p_customer_id: payment.customerId");
  });

  it("does not perform coupon, promotion or loyalty writes after checkout", () => {
    expect(posPage).not.toContain("await incrementPromotionUsage(");
    expect(posPage).not.toContain("await redeemLoyaltyPoints(");
    expect(posPage).not.toContain("applyCouponAtomic({");
    expect(posPage).not.toContain("earnLoyaltyPoints(customerId");
  });
  it("records customer credit in the same transaction as the invoice", () => {
    expect(migration).toContain("create table if not exists public.customer_debt_adjustments");
    expect(migration).toContain("unique (tenant_id, idempotency_key)");
    expect(migration).toContain("'legacy-balance:' || c.id::text");
    expect(migration).toContain("coalesce(c.debt, 0) - coalesce(inv.invoice_debt, 0)");
    expect(migration).toContain("'pos-credit:' || v_invoice_id::text");
    expect(migration).toContain("'pos-credit:' || p_invoice_id::text");
    expect(migration).toContain("POS_CUSTOMER_REQUIRED_FOR_CREDIT");
    expect(migration).toContain("POS_CUSTOMER_CREDIT_MISMATCH");
    expect(migration).toContain("POS_SESSION_BRANCH_MISMATCH");
    expect(migration).toContain("if v_invoice.status = 'completed' then");
    expect(checkoutService).toContain("p_customer_credit: input.customerCredit ?? 0");
    expect(orderService).toContain("p_customer_credit: payment.customerCredit ?? 0");
    expect(posPage).toContain("customerCredit: creditExcess");
    expect(posPage).not.toContain("adjustCustomerDebt(");
  });

});
