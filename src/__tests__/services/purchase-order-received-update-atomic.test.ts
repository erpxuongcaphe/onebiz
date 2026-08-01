import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentContext: vi.fn(),
  getCurrentTenantId: vi.fn(),
  getPaginationRange: vi.fn(),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { updateReceivedPurchaseOrderAtomic } from "@/lib/services/supabase/purchase-orders";

const migration = readFileSync(
  "supabase/migrations/00272_atomic_received_purchase_order_update.sql",
  "utf8",
);
const dialog = readFileSync(
  "src/components/shared/dialogs/create-purchase-order-dialog.tsx",
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      purchase_order_id: "po-1",
      code: "PO000001",
      status: "completed",
      paid: 700_000,
      debt: 455_000,
    },
    error: null,
  });
});

describe("atomic received purchase-order update", () => {
  it("sends the requested paid total and note through one RPC", async () => {
    const result = await updateReceivedPurchaseOrderAtomic({
      orderId: "po-1",
      requestedPaid: 700_000,
      note: "Da doi chieu",
      paymentMethod: "transfer",
    });

    expect(result).toMatchObject({ paid: 700_000, debt: 455_000 });
    expect(rpc).toHaveBeenCalledWith(
      "update_received_purchase_order_atomic",
      {
        p_purchase_order_id: "po-1",
        p_requested_paid: 700_000,
        p_note: "Da doi chieu",
        p_payment_method: "transfer",
      },
    );
  });

  it("locks and validates the server-side update", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("inventory.create_po");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("PAID_AMOUNT_CANNOT_DECREASE");
    expect(migration).toContain("PAYMENT_EXCEEDS_TOTAL");
    expect(migration).toContain("public.record_purchase_payment(");
    expect(migration).toContain("purchase_order_received_update");
  });

  it("removes the browser-side purchase-order update", () => {
    expect(dialog).toContain("updateReceivedPurchaseOrderAtomic({");
    expect(dialog).not.toContain('from("purchase_orders")');
    expect(dialog).not.toContain("recordPurchasePayment({");
  });
});
