import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock ===

const rpcCalls: { fn: string; args?: unknown }[] = [];
let kitchenRpcError: { message: string; code?: string } | null = null;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.is = vi.fn(self);
  chain.range = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  chain.insert = vi.fn(self);
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockFromHandler: (table: string) => any;

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => mockFromHandler(table)),
    rpc: vi.fn((fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "fnb_cancel_unpaid_order_atomic") {
        return { data: { success: true }, error: null };
      }
      if (fn === "fnb_send_to_kitchen_atomic_v2") {
        return { data: { kitchen_order_id: "ko-1", order_number: "KB00001" }, error: kitchenRpcError };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getKitchenOrders,
  getUnpaidFnbOrders,
  getKitchenOrdersWithItems,
  getKitchenOrderById,
  addItemsToOrder,
  updateKitchenOrderStatus,
  updateKitchenItemStatus,
  cancelUnpaidKitchenOrder,
  getFnbCancelErrorMessage,
} from "@/lib/services/supabase/kitchen-orders";

// === Fixtures ===

const NOW = new Date().toISOString();

const ORDER_ROW = {
  id: "ko-1",
  tenant_id: "t1",
  branch_id: "b1",
  invoice_id: null,
  table_id: "table-5",
  order_number: "KB00001",
  order_type: "dine_in",
  status: "pending",
  note: null,
  created_by: "u1",
  created_at: NOW,
  updated_at: NOW,
  restaurant_tables: { name: "Bàn 5" },
};

const ITEM_ROWS = [
  {
    id: "koi-1",
    kitchen_order_id: "ko-1",
    product_id: "p1",
    product_name: "Cà Phê Sữa Đá",
    variant_id: null,
    variant_label: null,
    quantity: 1,
    unit_price: 35000,
    note: "ít đá",
    toppings: [{ productId: "tp1", name: "Trân châu", quantity: 1, price: 8000 }],
    status: "pending",
    started_at: null,
    completed_at: null,
  },
  {
    id: "koi-2",
    kitchen_order_id: "ko-1",
    product_id: "p2",
    product_name: "Hồng Trà Đào",
    variant_id: null,
    variant_label: null,
    quantity: 2,
    unit_price: 29000,
    note: null,
    toppings: [],
    status: "pending",
    started_at: null,
    completed_at: null,
  },
];

beforeEach(() => {
  kitchenRpcError = null;
  rpcCalls.length = 0;

  mockFromHandler = (table: string) => {
    if (table === "kitchen_orders") {
      return createChain({ data: ORDER_ROW, error: null });
    }
    if (table === "kitchen_order_items") {
      return createChain({ data: ITEM_ROWS, error: null });
    }
    return createChain();
  };
});

describe("cancelUnpaidKitchenOrder", () => {
  it("diễn giải lỗi chi nhánh để thu ngân không nhầm với lỗi mạng", () => {
    expect(getFnbCancelErrorMessage({ message: "FNB_CANCEL_BRANCH_ACCESS_DENIED" }))
      .toBe("Anh/chị không có quyền huỷ đơn này tại chi nhánh hiện tại.");
  });

  it("chỉ rõ đơn đã thanh toán phải đi qua luồng huỷ hoá đơn", () => {
    expect(getFnbCancelErrorMessage({ message: "ORDER_ALREADY_PAID" }))
      .toBe("Đơn đã thanh toán. Hãy dùng luồng huỷ hoá đơn để hoàn kho và hoàn tiền đúng sổ.");
  });

  it("calls the secure atomic RPC with reason and shift context (no OTP)", async () => {
    await cancelUnpaidKitchenOrder({
      orderId: "ko-1",
      reasonCode: "Khách đổi ý",
      shiftId: "shift-1",
    });

    expect(rpcCalls).toContainEqual({
      fn: "fnb_cancel_unpaid_order_atomic",
      args: {
        p_order_id: "ko-1",
        p_reason_code: "Khách đổi ý",
        p_reason_note: null,
        p_shift_id: "shift-1",
        p_otp_id: null,
      },
    });
  });

  it("passes p_otp_id when caller supplies OTP for delegation flow (Phase 3a)", async () => {
    await cancelUnpaidKitchenOrder({
      orderId: "ko-2",
      reasonCode: "Khách bỏ đi",
      shiftId: "shift-1",
      otpId: "otp-uuid-789",
    });

    expect(rpcCalls).toContainEqual({
      fn: "fnb_cancel_unpaid_order_atomic",
      args: {
        p_order_id: "ko-2",
        p_reason_code: "Khách bỏ đi",
        p_reason_note: null,
        p_shift_id: "shift-1",
        p_otp_id: "otp-uuid-789",
      },
    });
  });

  it("keeps the free-text explanation separate from the reason code for audit", async () => {
    await cancelUnpaidKitchenOrder({
      orderId: "ko-3",
      reasonCode: "Khác",
      reasonNote: "Khách đổi sang đơn giao ngày mai",
      shiftId: "shift-2",
    });

    expect(rpcCalls).toContainEqual({
      fn: "fnb_cancel_unpaid_order_atomic",
      args: {
        p_order_id: "ko-3",
        p_reason_code: "Khác",
        p_reason_note: "Khách đổi sang đơn giao ngày mai",
        p_shift_id: "shift-2",
        p_otp_id: null,
      },
    });
  });

  it("keeps the free-text explanation when a manager delegates by OTP", async () => {
    await cancelUnpaidKitchenOrder({
      orderId: "ko-4",
      reasonCode: "Khác",
      reasonNote: "Nhập sai bàn phục vụ",
      shiftId: "shift-3",
      otpId: "otp-uuid-456",
    });

    expect(rpcCalls).toContainEqual({
      fn: "fnb_cancel_unpaid_order_atomic",
      args: {
        p_order_id: "ko-4",
        p_reason_code: "Khác",
        p_reason_note: "Nhập sai bàn phục vụ",
        p_shift_id: "shift-3",
        p_otp_id: "otp-uuid-456",
      },
    });
  });

  it("requires a cancel reason before hitting the RPC", async () => {
    await expect(
      cancelUnpaidKitchenOrder({ orderId: "ko-1", reasonCode: "   " }),
    ).rejects.toThrow("lý do");

    expect(rpcCalls.find((call) => call.fn === "fnb_cancel_unpaid_order_atomic")).toBeUndefined();
  });
});

// ============================================================

describe("getKitchenOrders", () => {
  it("returns mapped orders for branch", async () => {
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({
          data: [ORDER_ROW, { ...ORDER_ROW, id: "ko-2", order_number: "KB00002" }],
          error: null,
        });
      }
      return createChain();
    };

    const orders = await getKitchenOrders("b1", ["pending"]);
    expect(orders).toHaveLength(2);
    expect(orders[0].orderNumber).toBe("KB00001");
    expect(orders[0].tableName).toBe("Bàn 5");
    expect(orders[1].orderNumber).toBe("KB00002");
  });

  it("returns empty array when no orders", async () => {
    mockFromHandler = () => createChain({ data: [], error: null });
    const orders = await getKitchenOrders("b-empty");
    expect(orders).toEqual([]);
  });
});

describe("getKitchenOrdersWithItems", () => {
  it("loads active orders and items in bulk", async () => {
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({
          data: [ORDER_ROW],
          error: null,
        });
      }
      if (table === "kitchen_order_items") {
        return createChain({
          data: ITEM_ROWS,
          error: null,
        });
      }
      return createChain();
    };

    const orders = await getKitchenOrdersWithItems("b1", ["pending"]);

    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("ko-1");
    expect(orders[0].items).toHaveLength(2);
    expect(orders[0].items[0].kitchenOrderId).toBe("ko-1");
  });

  it("removes duplicated legacy modifier text but keeps the cashier note", async () => {
    const modifierSelections = [
      {
        groupId: "ice",
        groupName: "Mức đá",
        options: [{ optionId: "normal", label: "Bình thường", priceDelta: 0 }],
      },
      {
        groupId: "sugar",
        groupName: "Mức đường",
        options: [{ optionId: "80", label: "80%", priceDelta: 0 }],
      },
    ];
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({ data: [ORDER_ROW], error: null });
      }
      if (table === "kitchen_order_items") {
        return createChain({
          data: [
            {
              ...ITEM_ROWS[0],
              note: "Mức đá: Bình thường, Mức đường: 80% — Không ống hút",
              modifier_selections: modifierSelections,
            },
          ],
          error: null,
        });
      }
      return createChain();
    };

    const orders = await getKitchenOrdersWithItems("b1", ["pending"]);

    expect(orders[0].items[0].modifierSelections).toEqual(modifierSelections);
    expect(orders[0].items[0].note).toBe("Không ống hút");
  });
});

describe("getKitchenOrderById", () => {
  it("returns order with items", async () => {
    const order = await getKitchenOrderById("ko-1");

    expect(order.id).toBe("ko-1");
    expect(order.orderNumber).toBe("KB00001");
    expect(order.tableName).toBe("Bàn 5");
    expect(order.items).toHaveLength(2);
    expect(order.items[0].productName).toBe("Cà Phê Sữa Đá");
    expect(order.items[0].toppings).toHaveLength(1);
    expect(order.items[0].toppings[0].name).toBe("Trân châu");
    expect(order.items[1].quantity).toBe(2);
  });
});

describe("addItemsToOrder", () => {
  it("reads the original order branch with tenant and order filters", async () => {
    const chain = createChain({ data: { branch_id: "original-branch" }, error: null });
    mockFromHandler = () => chain;
    await addItemsToOrder("ko-cross-device", [], { batchId: "stable-branch" });
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "t1");
    expect(chain.eq).toHaveBeenCalledWith("id", "ko-cross-device");
    expect(rpcCalls[0]).toMatchObject({ args: { p_branch_id: "original-branch", p_existing_order_id: "ko-cross-device", p_idempotency_key: "stable-branch" } });
  });
  it("does not submit when the canonical order cannot be found", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });
    await expect(addItemsToOrder("missing", [])).rejects.toMatchObject({ kitchenRequestRejected: true });
    expect(rpcCalls).toHaveLength(0);
  });

  it.each(["P0001", "PT409", "42501", "22023"])("marks SQL rejection %s without losing its message", async (code) => {
    kitchenRpcError = { code, message: "PRICE_CHANGED" };
    await expect(addItemsToOrder("ko-1", [], { batchId: "stable" }))
      .rejects.toMatchObject({ kitchenRequestRejected: true, message: "[addItemsToOrder:atomic_rpc] PRICE_CHANGED" });
  });

  it("does not classify lost transport as a definite rejection", async () => {
    kitchenRpcError = { message: "Failed to fetch" };
    const error = await addItemsToOrder("ko-1", []).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("kitchenRequestRejected");
  });

  it("sends additional items through the atomic kitchen RPC", async () => {
    await addItemsToOrder("ko-1", [
      {
        productId: "p3",
        productName: "Cold Brew",
        quantity: 1,
        unitPrice: 55000,
      },
    ]);

    const rpcCall = rpcCalls.find(
      (call) => call.fn === "fnb_send_to_kitchen_atomic_v2",
    );
    expect(rpcCall).toBeDefined();
    const params = rpcCall?.args as Record<string, unknown>;
    expect(params.p_existing_order_id).toBe("ko-1");
    expect(params.p_branch_id).toBe(ORDER_ROW.branch_id);
    expect(params.p_items).toEqual([
      {
        productId: "p3",
        productName: "Cold Brew",
        quantity: 1,
        unitPrice: 55000,
      },
    ]);
  });
});

describe("updateKitchenOrderStatus", () => {
  it("marks a ready order as served", async () => {
    await updateKitchenOrderStatus("ko-1", "served");
    // No throw = success
  });
});

describe("updateKitchenItemStatus", () => {
  it("cycles: pending → preparing", async () => {
    await updateKitchenItemStatus("koi-1", "preparing");
    // No throw = success
  });

  it("cycles: preparing → ready", async () => {
    await updateKitchenItemStatus("koi-1", "ready");
    // No throw = success
  });
});

describe("getUnpaidFnbOrders", () => {
  it("reads shared served/unpaid orders with tenant and branch scope and scoped items", async () => {
    const orderChain = createChain({ data: [{ ...ORDER_ROW, invoice_id: null, merged_into_id: null, status: "served" }], error: null });
    const itemChain = createChain({ data: ITEM_ROWS, error: null });
    mockFromHandler = (table) => table === "kitchen_orders" ? orderChain : itemChain;
    const result = await getUnpaidFnbOrders("b1");
    expect(orderChain.eq).toHaveBeenCalledWith("tenant_id", "t1");
    expect(orderChain.eq).toHaveBeenCalledWith("branch_id", "b1");
    expect(orderChain.is).toHaveBeenCalledWith("invoice_id", null);
    expect(orderChain.is).toHaveBeenCalledWith("merged_into_id", null);
    expect(orderChain.in).toHaveBeenCalledWith("status", ["pending", "preparing", "ready", "served"]);
    expect(itemChain.in).toHaveBeenCalledWith("kitchen_order_id", [ORDER_ROW.id]);
    expect(result).toHaveLength(1);
    expect(result[0].itemCount).toBe(3);
    expect(result[0].provisionalTotal).toBeGreaterThan(0);
  });
  it("returns no orders on a truly empty branch", async () => {
    mockFromHandler = () => createChain({ data: [], error: null });
    expect(await getUnpaidFnbOrders("empty")).toEqual([]);
  });
});
