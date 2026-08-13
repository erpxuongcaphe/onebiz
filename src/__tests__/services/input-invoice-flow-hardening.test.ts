import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(
  "src/components/shared/dialogs/create-input-invoice-dialog.tsx",
  "utf8",
);
const purchaseService = readFileSync(
  "src/lib/services/supabase/purchase-orders.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00261_atomic_purchase_order_save.sql",
  "utf8",
);
const purchaseDialog = readFileSync(
  "src/components/shared/dialogs/create-purchase-order-dialog.tsx",
  "utf8",
);
const receivedUpdateMigration = readFileSync(
  "supabase/migrations/00272_atomic_received_purchase_order_update.sql",
  "utf8",
);

describe("Input invoice data flow hardening", () => {
  it("saves the document, items and stock receipt through one RPC", () => {
    expect(dialog).toContain("savePurchaseOrderAtomic({");
    expect(dialog).toContain("receiveNow: true");
    expect(dialog).not.toMatch(/\.from\("purchase_orders"\)[\s\S]{0,120}\.insert\(/);
    expect(dialog).not.toMatch(/\.from\("purchase_order_items"\)[\s\S]{0,120}\.insert\(/);
    expect(dialog).toContain('nextEntityCode("purchase_order")');
  });

  it("records stock and the selected payment method in the same transaction", () => {
    expect(dialog).toContain(
      'paymentMethod === "bank_transfer" ? "transfer" : "cash"',
    );
    expect(purchaseService).toContain('"save_purchase_order_with_uom_atomic"');
    expect(purchaseService).toContain("p_payment_method");
    expect(migration).toContain("public.receive_purchase_items_atomic(");
    expect(migration).toContain("public.record_purchase_payment(");
  });

  it("rolls back instead of leaving a recoverable partial document", () => {
    expect(dialog).not.toContain("createdPoId");
    expect(dialog).not.toContain("Phiếu đã được lưu nhưng chưa hoàn tất");
    expect(migration).toContain("save_purchase_order_atomic");
    expect(migration).toContain("security definer");
  });

  it("keeps later payments on received POs tied to a cash voucher", () => {
    expect(purchaseDialog).toContain(
      "await updateReceivedPurchaseOrderAtomic({",
    );
    expect(purchaseDialog).not.toContain("await recordPurchasePayment");
    expect(receivedUpdateMigration).toContain(
      "v_payment_delta := v_requested_paid - v_order.paid",
    );
    expect(receivedUpdateMigration).toContain(
      "public.record_purchase_payment(",
    );
    expect(receivedUpdateMigration).toContain(
      "'purchase_order_received_update'",
    );
  });
});
