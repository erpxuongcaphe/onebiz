import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00251_harden_fnb_send_kitchen.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/fnb-checkout.ts",
  "utf8",
);
const kitchenOrderService = readFileSync(
  "src/lib/services/supabase/kitchen-orders.ts",
  "utf8",
);

describe("F&B send-to-kitchen hardening", () => {
  it("derives actor and tenant, then checks permission and branch access", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("pos_fnb.send_kitchen");
    expect(migration).toContain("public.user_has_branch_access");
    expect(migration).toContain("ACTIVE_PROFILE_REQUIRED");
  });

  it("rebuilds catalog snapshots and validates price-sensitive data", () => {
    expect(migration).toContain("PRODUCT_NOT_AVAILABLE");
    expect(migration).toContain("PRODUCT_VARIANT_NOT_AVAILABLE");
    expect(migration).toContain("MODIFIER_GROUP_NOT_APPLICABLE");
    expect(migration).toContain("TOPPING_NOT_AVAILABLE");
    expect(migration).toContain("PRICE_CHANGED:");
    expect(migration).toContain("pos_fnb.edit_price");
  });

  it("persists delivery metadata in the same order transaction", () => {
    expect(migration).toContain("delivery_platform,");
    expect(migration).toContain("platform_commission_percent,");
    expect(migration).toContain("delivery_staff_id,");
    expect(migration).toContain("delivery_distance_tier,");
    expect(migration).toContain("DELIVERY_FEE_TIER_NOT_CONFIGURED");
  });

  it("uses one batch record for supplemental-item idempotency", () => {
    expect(migration).toContain("public.fnb_kitchen_item_batches");
    expect(migration).toContain("unique (kitchen_order_id, batch_key)");
    expect(migration).toContain("p_existing_order_id");
    expect(migration).toContain("KITCHEN_ORDER_CLOSED");
    expect(migration).toContain("on conflict (kitchen_order_id, batch_key)");
    expect(migration).toContain("fnb_add_kitchen_items");
  });

  it("client calls only v2 and does not send actor or tenant parameters", () => {
    const sendSection = service.slice(
      service.indexOf("export async function sendToKitchen"),
      service.indexOf("// Bước 2:"),
    );
    expect(sendSection).toContain('"fnb_send_to_kitchen_atomic_v2"');
    expect(sendSection).not.toContain("p_tenant_id");
    expect(sendSection).not.toContain("p_created_by");
    expect(sendSection).not.toContain('.from("kitchen_orders").update');

    const addSection = kitchenOrderService.slice(
      kitchenOrderService.indexOf("export async function addItemsToOrder"),
      kitchenOrderService.indexOf("* Update kitchen order status"),
    );
    expect(addSection).toContain('"fnb_send_to_kitchen_atomic_v2"');
    expect(addSection).toContain("p_existing_order_id: orderId");
    expect(addSection).not.toContain('.from("kitchen_order_items").insert');
  });
});
