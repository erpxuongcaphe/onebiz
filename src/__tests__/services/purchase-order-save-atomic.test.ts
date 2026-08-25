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

import { savePurchaseOrderAtomic, updatePurchaseOrderStatus } from "@/lib/services/supabase/purchase-orders";

const migration = readFileSync(
  "supabase/migrations/00261_atomic_purchase_order_save.sql",
  "utf8",
);
const roundingMigration = readFileSync(
  "supabase/migrations/00299_align_purchase_order_vnd_rounding.sql",
  "utf8",
);
const stateMigration = readFileSync(
  "supabase/migrations/00262_atomic_purchase_order_state.sql",
  "utf8",
);
const replaySafeMigration = readFileSync(
  "supabase/migrations/00346_purchase_order_save_replay_safe.sql",
  "utf8",
);
const purchaseEntriesService = readFileSync(
  "src/lib/services/supabase/purchase-entries.ts",
  "utf8",
);
const purchaseEntryPage = readFileSync(
  "src/app/(main)/hang-hoa/dat-hang-nhap/page.tsx",
  "utf8",
);
const dialog = readFileSync(
  "src/components/shared/dialogs/create-purchase-order-dialog.tsx",
  "utf8",
);
const inputInvoiceDialog = readFileSync(
  "src/components/shared/dialogs/create-input-invoice-dialog.tsx",
  "utf8",
);
const purchaseEntryDialog = readFileSync(
  "src/components/shared/dialogs/create-purchase-entry-dialog.tsx",
  "utf8",
);
const excelImportService = readFileSync(
  "src/lib/services/supabase/excel-import.ts",
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      purchase_order_id: "po-1",
      code: "PO000001",
      status: "completed",
      total: 1_155_000,
      paid: 500_000,
      debt: 655_000,
    },
    error: null,
  });
});

describe("atomic purchase-order save", () => {
  it("sends only business inputs and derives actor data on the server", async () => {
    const result = await savePurchaseOrderAtomic({
      requestedCode: "PO-IMPORT-001",
      branchId: "branch-1",
      supplierId: "supplier-1",
      shippingCost: 50_000,
      otherCost: 25_000,
      orderDiscount: 20_000,
      paidAmount: 500_000,
      paymentMethod: "transfer",
      receiveNow: true,
      items: [
        {
          productId: "product-1",
          quantity: 10,
          unitPrice: 100_000,
          discount: 0,
          vatRate: 10,
        },
      ],
    });

    expect(result).toMatchObject({
      orderId: "po-1",
      code: "PO000001",
      status: "completed",
    });
    expect(rpc).toHaveBeenCalledWith(
      "save_purchase_order_with_uom_atomic_v2",
      expect.objectContaining({
        p_requested_code: "PO-IMPORT-001",
        p_branch_id: "branch-1",
        p_supplier_id: "supplier-1",
        p_receive_now: true,
        p_payment_method: "transfer",
        p_mark_ordered: false,
      }),
    );
    const params = rpc.mock.calls[0][1];
    expect(params).not.toHaveProperty("p_actor_id");
    expect(params).not.toHaveProperty("p_tenant_id");
  });

  it("retries an ambiguous response with the same reserved code", async () => {
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    rpc.mockResolvedValueOnce({
      data: {
        purchase_order_id: "po-1",
        code: "PO000269",
        status: "completed",
        total: 98_000,
        paid: 98_000,
        debt: 0,
        idempotent: true,
      },
      error: null,
    });

    const result = await savePurchaseOrderAtomic({
      requestedCode: "PO000269",
      branchId: "branch-1",
      supplierId: "supplier-1",
      receiveNow: true,
      items: [
        {
          productId: "product-1",
          quantity: 1,
          unitPrice: 98_000,
          discount: 0,
          vatRate: 0,
        },
      ],
    });

    expect(result.idempotent).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, params] of rpc.mock.calls) {
      expect(params.p_requested_code).toBe("PO000269");
    }
  });

  it("fails closed when the server transaction fails", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "LINE_DISCOUNT_EXCEEDS_VALUE" },
    });

    await expect(
      savePurchaseOrderAtomic({
        branchId: "branch-1",
        supplierId: "supplier-1",
        items: [
          {
            productId: "product-1",
            quantity: 1,
            unitPrice: 10,
            discount: 20,
            vatRate: 0,
          },
        ],
      }),
    ).rejects.toThrow("LINE_DISCOUNT_EXCEEDS_VALUE");
  });

  it("validates tenant, permission, branch, supplier and product in SQL", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("inventory.create_po");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("SUPPLIER_NOT_FOUND");
    expect(migration).toContain("PRODUCT_NOT_FOUND");
    expect(migration).toContain("PURCHASE_ORDER_NOT_EDITABLE");
    expect(migration).toContain("shipping_cost = v_shipping_cost");
    expect(migration).toContain("other_cost = v_other_cost");
    expect(migration).toContain("receive_purchase_items_atomic");
    expect(migration).toContain("public.record_purchase_payment(");
  });

  it("removes multi-step header and item writes from the form", () => {
    expect(dialog).toContain("savePurchaseOrderAtomic({");
    expect(dialog).toContain(
      "requestedCode: isEdit && editingPO ? editingPO.code : code",
    );
    expect(dialog).not.toMatch(/\.from\("purchase_order_items"\)[\s\S]{0,120}\.insert\(/);
    expect(dialog).not.toMatch(/\.from\("purchase_order_items"\)[\s\S]{0,120}\.delete\(/);
    expect(dialog).not.toContain("await receivePurchaseOrder(");
    expect(inputInvoiceDialog).toContain("savePurchaseOrderAtomic({");
    expect(inputInvoiceDialog).not.toMatch(/\.from\("purchase_orders"\)[\s\S]{0,120}\.insert\(/);
    expect(purchaseEntryDialog).toContain("savePurchaseOrderAtomic({");
    expect(purchaseEntryDialog).toContain("markOrdered: true");
    expect(purchaseEntryDialog).not.toMatch(/\.from\("purchase_orders"\)[\s\S]{0,120}\.insert\(/);
    expect(excelImportService).toContain("savePurchaseOrderAtomic({");
    expect(excelImportService).toContain("requestedCode: code");
    expect(excelImportService).not.toMatch(/bulkImportPurchaseOrders[\s\S]{0,7000}\.from\("purchase_orders"\)[\s\S]{0,120}\.insert\(/);
    expect(excelImportService).not.toMatch(/bulkImportPurchaseOrders[\s\S]{0,7000}\.from\("purchase_orders"\)[\s\S]{0,120}\.delete\(/);
  });

  it("makes receipt creation replay-safe without repeating stock or debt writes", () => {
    expect(replaySafeMigration).toContain("pg_advisory_xact_lock");
    expect(replaySafeMigration).toContain("purchase_order_save_keys");
    expect(replaySafeMigration).toContain("v_saved_hash <> v_request_hash");
    expect(replaySafeMigration).toContain("PURCHASE_ORDER_CODE_CONFLICT");
    expect(replaySafeMigration).toContain("created_by <> v_actor");
    expect(replaySafeMigration).toContain("user_has_branch_access");
    expect(replaySafeMigration).toContain("'idempotent', true");
    expect(replaySafeMigration).toContain(
      "return public.save_purchase_order_with_uom_atomic(",
    );
    expect(replaySafeMigration).toContain(
      "revoke all on function public.save_purchase_order_with_uom_atomic_v2",
    );
    expect(replaySafeMigration).toContain(
      "revoke all on table public.purchase_order_save_keys from public, anon, authenticated",
    );
  });
  it("changes ordered/cancelled state through an audited server lock", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        purchase_order_id: "po-1",
        code: "PO000001",
        status: "cancelled",
        idempotent: false,
      },
      error: null,
    });

    await updatePurchaseOrderStatus("po-1", "cancelled", "Nhà cung cấp hết hàng");

    expect(rpc).toHaveBeenCalledWith("set_purchase_order_state_atomic", {
      p_purchase_order_id: "po-1",
      p_new_status: "cancelled",
      p_reason: "Nhà cung cấp hết hàng",
    });
    expect(stateMigration).toContain("for update");
    expect(stateMigration).toContain("user_has_branch_access");
    expect(stateMigration).toContain("purchase_order_cancel");
    expect(stateMigration).toContain("ACTOR_SPOOF_BLOCKED");
    expect(stateMigration).toContain("poi.purchase_order_id = p_order_id");
    expect(stateMigration).toContain("v_order.status not in ('ordered', 'partial')");
    expect(purchaseEntryPage).toContain('selectedRows.filter((r) => r.status === "pending")');
    expect(purchaseEntryPage).toContain('row.status === "pending"');
    expect(purchaseEntriesService).toContain("updatePurchaseOrderStatus(");
    expect(purchaseEntriesService).not.toMatch(
      /cancelPurchaseOrderEntry[\s\S]{0,700}\.from\("purchase_orders"\)[\s\S]{0,120}\.update\(/,
    );
  });


  it("keeps whole-VND line rounding identical in the form and atomic RPC", () => {
    const items = [
      { quantity: 24, unitPrice: 5_125 },
      { quantity: 48, unitPrice: 7_708.33 },
      { quantity: 72, unitPrice: 12_166.67 },
    ];
    const subtotal = items.reduce(
      (sum, item) => sum + Math.ceil(item.quantity * item.unitPrice),
      0,
    );

    expect(subtotal).toBe(1_369_001);
    expect(subtotal - 1).toBe(1_369_000);
    expect(dialog).toContain(
      "return Math.ceil(lineEffectivePrice(item) * item.quantity)",
    );
    expect(
      roundingMigration.match(/:= ceil\(v_quantity \* v_unit_price\)/g),
    ).toHaveLength(2);
    expect(roundingMigration).not.toContain(
      "round(v_quantity * v_unit_price, 2)",
    );
  });
});
