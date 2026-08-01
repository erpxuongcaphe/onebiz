import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00252_harden_fnb_kds_delivery.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/kitchen-orders.ts",
  "utf8",
);
const posPage = readFileSync("src/app/pos/fnb/page.tsx", "utf8");

describe("F&B KDS and delivery hardening", () => {
  it("checks actor, permission, tenant and branch in server RPCs", () => {
    expect(migration.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration.match(/user_has_permission/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration.match(/user_has_branch_access/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("ACTIVE_PROFILE_REQUIRED");
  });

  it("guards KDS state transitions and synchronizes order status", () => {
    expect(migration).toContain("INVALID_KITCHEN_ITEM_TRANSITION");
    expect(migration).toContain("ORDER_ITEMS_NOT_READY");
    expect(migration).toContain("ORDER_STATUS_MANAGED_BY_ITEMS");
    expect(migration).toContain("fnb_kitchen_item_status");
    expect(migration).toContain("fnb_kitchen_order_served");
  });

  it("protects delivery pricing and delivery staff assignment", () => {
    expect(migration).toContain("PLATFORM_COMMISSION_OVERRIDE_DENIED");
    expect(migration).toContain("DELIVERY_FEE_TIER_NOT_CONFIGURED");
    expect(migration).toContain("DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH");
    expect(migration).toContain("fnb_delivery_pricing_updated");
  });

  it("client mutations use RPCs instead of direct table writes", () => {
    expect(service).toContain('"fnb_update_kitchen_item_status_v2"');
    expect(service).toContain('"fnb_update_kitchen_order_status_v2"');
    expect(service).toContain('"fnb_set_delivery_pricing_v2"');

    const platformSection = service.slice(
      service.indexOf("export async function setDeliveryPlatform"),
      service.indexOf("// Delivery staff tracking"),
    );
    expect(platformSection).not.toContain('.from("kitchen_orders").update');

    const unassignSection = service.slice(
      service.indexOf("export async function unassignDeliveryStaff"),
      service.indexOf("* Đánh dấu shipper"),
    );
    expect(unassignSection).toContain('"assign_delivery_staff_to_order"');
    expect(unassignSection).not.toContain('.from("kitchen_orders").update');
  });

  it("desktop and mobile use the same persisted delivery handlers", () => {
    expect(
      posPage.match(/onDeliveryPlatformChange=\{handleDeliveryPlatformChange\}/g)
        ?.length,
    ).toBe(2);
    expect(
      posPage.match(/onDeliveryStaffChange=\{handleDeliveryStaffChange\}/g)
        ?.length,
    ).toBe(2);
    expect(
      posPage.match(/onDeliveryTierChange=\{handleDeliveryTierChange\}/g)
        ?.length,
    ).toBe(2);
  });
});
