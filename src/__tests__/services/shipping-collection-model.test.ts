import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00319_shipping_collection_and_receiver.sql",
  "utf8",
);
const shippingService = readFileSync("src/lib/services/supabase/shipping.ts", "utf8");
const orderService = readFileSync("src/lib/services/supabase/orders.ts", "utf8");
const pos = readFileSync("src/app/pos/page.tsx", "utf8");
const shipmentDialog = readFileSync(
  "src/components/shared/dialogs/create-shipment-dialog.tsx",
  "utf8",
);
const shippingOrderDialog = readFileSync(
  "src/components/shared/dialogs/create-shipping-order-dialog.tsx",
  "utf8",
);

describe("buyer, receiver and delivery collection are independent", () => {
  it("does not rewrite historical shipments", () => {
    expect(migration).toContain("Existing shipments keep collection_mode = NULL");
    expect(migration).not.toMatch(/update public\.shipping_orders\s+set collection_mode[\s\S]+where collection_mode is null/i);
  });

  it("forces no-collection shipments to zero even after a later legacy update", () => {
    expect(migration).toContain("if new.collection_mode = 'none' then");
    expect(migration).toContain("new.cod_amount := 0");
    expect(migration).toContain("before insert or update of cod_amount, collection_mode, receiver_customer_id");
  });

  it("validates linked receiver customer inside the authenticated tenant", () => {
    expect(migration.match(/c\.tenant_id = v_tenant_id/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("SHIPMENT_RECEIVER_CUSTOMER_INVALID");
  });

  it("new client writes only use explicit v2 contracts", () => {
    expect(shippingService).toContain('"attach_invoice_shipment_atomic_v2"');
    expect(orderService).toContain('"save_sales_order_atomic_v2"');
    expect(shippingService).toContain("p_collection_mode: input.collectionMode");
    expect(orderService).toContain("p_collection_mode: input.collectionMode");
  });

  it("POS and both shipment dialogs expose the short Vietnamese choices", () => {
    for (const source of [pos, shipmentDialog, shippingOrderDialog]) {
      expect(source).toContain("Thu khi giao");
      expect(source).toContain("Không thu");
      expect(source).toContain("Giống người mua");
    }
    expect(pos).toContain('collectionMode: di.codEnabled ? "cod" : "none"');
  });
});
