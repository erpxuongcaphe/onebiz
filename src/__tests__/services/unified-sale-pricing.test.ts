import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePlatformPrice } from "@/lib/services/supabase/platform-prices";

const migration = readFileSync(
  "supabase/migrations/00363_unified_sale_pricing.sql",
  "utf8",
);
const fnbPos = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
const pricingService = readFileSync(
  "src/lib/services/supabase/pricing.ts",
  "utf8",
);
const productDialog = readFileSync(
  "src/components/shared/dialogs/create-product-dialog.tsx",
  "utf8",
);
const productPlatformTab = readFileSync(
  "src/components/shared/product-platform-prices-tab.tsx",
  "utf8",
);

describe("unified sale pricing 00363", () => {
  it("resolves platform size before product and keeps direct orders on normal pricing", () => {
    const entry = {
      product: { grab_food: 30_000 },
      variants: {
        sizeL: { grab_food: 35_000 },
      },
    } as const;

    expect(
      resolvePlatformPrice({ entry, platform: "grab_food", variantId: "sizeL" }),
    ).toBe(35_000);
    expect(
      resolvePlatformPrice({ entry, platform: "grab_food", variantId: "sizeM" }),
    ).toBe(30_000);
    expect(resolvePlatformPrice({ entry, platform: "direct", variantId: "sizeL" })).toBeNull();
  });

  it("adds scheduled assignments, sparse unique keys, permission guards and audit", () => {
    expect(migration).toContain("branch_price_tier_assignments");
    expect(migration).toContain("validity_mode in ('indefinite', 'fixed')");
    expect(migration).toContain("uq_price_tier_item_product_qty");
    expect(migration).toContain("uq_price_tier_item_variant_qty");
    expect(migration).toContain("products.manage_prices");
    expect(migration).toContain("PRICE_ASSIGNMENT_OVERLAP");
    expect(migration).toContain("insert into public.audit_log");
  });

  it("exposes one resolver with the approved fallback order and source metadata", () => {
    expect(migration).toContain("resolve_sale_price_00363");
    expect(migration).toContain("platform_variant");
    expect(migration).toContain("platform_product");
    expect(migration).toContain("tier_variant");
    expect(migration).toContain("tier_product");
    expect(migration).toContain("catalog_variant");
    expect(migration).toContain("price_tier_item_id");
    expect(migration).toContain("platform_price_id");
    expect(migration).toContain("and ppp.variant_id is null");
  });

  it("wires FnB POS variants and scheduled tier lookup without removing rollout fallback", () => {
    expect(fnbPos).toContain("priceVariantsForActiveTab");
    expect(fnbPos).toContain("resolveConfiguredFnbPrice");
    expect(fnbPos).toContain("variant_id, platform, override_price");
    expect(pricingService).toContain("resolve_branch_price_tier_00363");
    expect(pricingService).toContain("isRpcUnavailable(resolveError)");
    expect(productPlatformTab).toContain("if (!r.variantId)");
  });

  it("uses component Retail selling prices for FnB costing in both UI and database", () => {
    expect(productDialog).toContain('productChannel === "fnb"');
    expect(productDialog).toContain("Number(product.sellPrice) || 0");
    expect(productDialog).toContain("chưa có giá bán Retail lớn hơn 0");
    expect(migration).toContain("calculate_fnb_bom_retail_cost_00363");
    expect(migration).toContain("FNB_COMPONENT_RETAIL_PRICE_MISSING");
    expect(migration).toContain("component_retail_sell_price");
  });
});
