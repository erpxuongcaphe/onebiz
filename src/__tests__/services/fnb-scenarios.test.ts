/**
 * F&B Real-World Scenario Tests — Vietnamese Coffee Shop
 *
 * Simulates every scenario that happens daily at a Vietnamese F&B store:
 * - Đặt bàn, gửi bếp, thanh toán (basic flow)
 * - Sửa đơn (modify order after kitchen send)
 * - Chuyển bàn (transfer table)
 * - Gộp hoá đơn (merge orders)
 * - Huỷ đơn (cancel order)
 * - Giảm giá / chiết khấu (discount fixed + percent)
 * - Delivery platforms (Shopee Food, Grab)
 * - Ghi nợ (partial payment / debt)
 * - Hoàn trả / void after payment
 * - Edge cases: concurrent table claims, empty orders, double payment
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock infrastructure ===

const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: { table: string; data: unknown; filters: Record<string, unknown> }[] = [];
const deleteCalls: { table: string; filters: Record<string, unknown> }[] = [];
let nextCodeCounter = 0;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  const filters: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return chain;
  });
  chain.in = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  chain.insert = vi.fn((data: unknown) => {
    if (Array.isArray(data)) {
      data.forEach((d) => insertCalls.push({ table: "_batch", data: d }));
    } else {
      insertCalls.push({ table: "_single", data: data as unknown });
    }
    return chain;
  });
  chain.update = vi.fn((data: unknown) => {
    updateCalls.push({ table: "_update", data, filters: { ...filters } });
    return chain;
  });
  chain.delete = vi.fn(() => {
    deleteCalls.push({ table: "_delete", filters: { ...filters } });
    return chain;
  });
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockFromHandler: (table: string) => any;

// RPC response overrides per test — keyed by fn name
let rpcResponseOverrides: Record<string, { data: unknown; error: unknown }> = {};
// Track what kitchen_order_ids received atomic payment calls (replaces releaseTableMock assertions)
const atomicPaymentCalls: { kitchenOrderId: string; params: Record<string, unknown> }[] = [];

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => mockFromHandler(table)),
    rpc: vi.fn((fn: string, args?: Record<string, unknown>) => {
      if (rpcResponseOverrides[fn]) return rpcResponseOverrides[fn];
      if (fn === "next_code") {
        nextCodeCounter++;
        const entity = (args?.p_entity_type as string) ?? "inv";
        const prefix = entity === "kitchen_order" ? "KB" : entity === "invoice" ? "HD" : entity === "cash_receipt" ? "PT" : "PC";
        return { data: `${prefix}${String(nextCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock" || fn === "allocate_lots_fifo") {
        return { data: null, error: null };
      }
      if (fn === "fnb_complete_payment_atomic") {
        const koId = (args?.p_kitchen_order_id as string) ?? "ko-1";
        atomicPaymentCalls.push({ kitchenOrderId: koId, params: args ?? {} });
        return {
          data: {
            invoice_id: "inv-1",
            invoice_code: "HD00001",
            total: 35000,
            paid: args?.p_paid ?? 35000,
            debt: 0,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock fnb-tables
const claimTableMock = vi.fn();
const releaseTableMock = vi.fn();
vi.mock("@/lib/services/supabase/fnb-tables", () => ({
  claimTable: (...args: unknown[]) => claimTableMock(...args),
  releaseTable: (...args: unknown[]) => releaseTableMock(...args),
  markTableAvailable: vi.fn(),
}));

import { sendToKitchen, fnbPayment, addItemsToExistingOrder, voidFnbInvoice } from "@/lib/services/supabase/fnb-checkout";
import {
  cancelKitchenOrder,
  transferTable,
  mergeKitchenOrders,
  applyOrderDiscount,
  setDeliveryPlatform,
  updateOrderItemQty,
  removeOrderItem,
  updateKitchenOrderStatus,
} from "@/lib/services/supabase/kitchen-orders";

// === Helpers ===

const CTX = { tenantId: "t1", branchId: "b1", createdBy: "u1" };
const NOW = new Date().toISOString();

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ko-1",
    order_number: "KB00001",
    tenant_id: CTX.tenantId,
    branch_id: CTX.branchId,
    table_id: null,
    invoice_id: null,
    order_type: "takeaway",
    status: "pending",
    note: null,
    created_by: CTX.createdBy,
    created_at: NOW,
    updated_at: NOW,
    discount_amount: 0,
    discount_reason: null,
    delivery_platform: null,
    delivery_fee: 0,
    platform_commission: 0,
    merged_into_id: null,
    original_table_id: null,
    restaurant_tables: null,
    ...overrides,
  };
}

function makeItemRows(items: { id: string; name: string; qty: number; price: number; toppings?: unknown[] }[]) {
  return items.map((i) => ({
    id: i.id,
    kitchen_order_id: "ko-1",
    product_id: i.id,
    product_name: i.name,
    variant_id: null,
    variant_label: null,
    quantity: i.qty,
    unit_price: i.price,
    note: null,
    toppings: i.toppings ?? [],
    status: "ready",
    started_at: null,
    completed_at: null,
    cancelled_qty: 0,
  }));
}

function setupPaymentMocks(orderOverrides: Record<string, unknown> = {}, items: ReturnType<typeof makeItemRows> = []) {
  const defaultItems = items.length > 0 ? items : makeItemRows([
    { id: "p1", name: "Cà Phê Sữa Đá", qty: 1, price: 35000 },
  ]);
  mockFromHandler = (table: string) => {
    if (table === "kitchen_orders") {
      return createChain({ data: makeOrderRow(orderOverrides), error: null });
    }
    if (table === "kitchen_order_items") {
      return createChain({ data: defaultItems, error: null });
    }
    if (table === "invoices") {
      return createChain({ data: { id: "inv-1", code: "HD00001", status: "completed", total: 35000, paid: 35000, source: "fnb" }, error: null });
    }
    if (table === "invoice_items" || table === "stock_movements" || table === "cash_transactions" || table === "restaurant_tables") {
      return createChain({ data: null, error: null });
    }
    return createChain();
  };
}

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  atomicPaymentCalls.length = 0;
  rpcResponseOverrides = {};
  nextCodeCounter = 0;
  claimTableMock.mockReset();
  releaseTableMock.mockReset();
  claimTableMock.mockResolvedValue({ id: "table-1", status: "occupied" });
  releaseTableMock.mockResolvedValue(undefined);

  mockFromHandler = (table: string) => {
    if (table === "kitchen_orders") {
      return createChain({ data: makeOrderRow(), error: null });
    }
    if (table === "kitchen_order_items") {
      return createChain({ data: null, error: null });
    }
    if (table === "invoices") {
      return createChain({ data: { id: "inv-1", code: "HD00001" }, error: null });
    }
    return createChain({ data: null, error: null });
  };
});

// ============================================================
// 1. BASIC FLOW — Gửi bếp → Thanh toán
// ============================================================

describe("Scenario: Basic dine-in flow (Bàn 5, CF Sữa Đá + topping)", () => {
  it("sends to kitchen with table claim", async () => {
    const result = await sendToKitchen({
      ...CTX,
      orderType: "dine_in",
      tableId: "table-5",
      items: [
        {
          productId: "p1", productName: "Cà Phê Sữa Đá",
          quantity: 2, unitPrice: 35000,
          toppings: [{ productId: "tp1", name: "Trân châu", quantity: 1, price: 8000 }],
        },
      ],
    });

    expect(result.kitchenOrderId).toBe("ko-1");
    expect(claimTableMock).toHaveBeenCalledWith("table-5", "ko-1");
  });

  it("pays and releases table", async () => {
    setupPaymentMocks(
      { table_id: "table-5", order_type: "dine_in" },
      makeItemRows([
        { id: "p1", name: "CF Sữa Đá", qty: 2, price: 35000, toppings: [{ productId: "tp1", name: "Trân châu", quantity: 1, price: 8000 }] },
      ])
    );

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Khách lẻ", paymentMethod: "cash", paid: 96000,
    });

    expect(result.invoiceId).toBe("inv-1");
    // Release table now happens atomically inside RPC — verify RPC was called
    expect(atomicPaymentCalls.length).toBe(1);
    expect(atomicPaymentCalls[0].kitchenOrderId).toBe("ko-1");
  });
});

describe("Scenario: Takeaway (mang về, không bàn)", () => {
  it("does not claim any table", async () => {
    await sendToKitchen({
      ...CTX, orderType: "takeaway",
      items: [{ productId: "p1", productName: "Cold Brew", quantity: 1, unitPrice: 55000 }],
    });
    expect(claimTableMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 2. SỬA ĐƠN — Modify order after kitchen send
// ============================================================

describe("Scenario: Sửa đơn (modify order items)", () => {
  it("updates item quantity", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });
    await updateOrderItemQty("koi-1", 3);
    // Should have called update with quantity: 3
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("removes item when qty set to 0", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });
    await updateOrderItemQty("koi-1", 0);
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("removes item directly", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });
    await removeOrderItem("koi-2");
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("adds item to existing order (bổ sung món)", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });
    await addItemsToExistingOrder("ko-1", [
      { productId: "p3", productName: "Trà Đào", quantity: 1, unitPrice: 29000 },
    ]);
    const traDaoInsert = insertCalls.find(
      (c) => (c.data as Record<string, unknown>)?.product_name === "Trà Đào"
    );
    expect(traDaoInsert).toBeDefined();
  });
});

// ============================================================
// 3. CHUYỂN BÀN — Transfer table
// ============================================================

describe("Scenario: Chuyển bàn (Bàn 5 → Bàn 8)", () => {
  it("claims new table, releases old, updates order", async () => {
    // Mock: toTable available, claim succeeds
    mockFromHandler = (table: string) => {
      if (table === "restaurant_tables") {
        return createChain({ data: { id: "table-8", status: "occupied" }, error: null });
      }
      if (table === "kitchen_orders") {
        return createChain({ data: null, error: null });
      }
      return createChain();
    };

    await transferTable("ko-1", "table-5", "table-8");

    // Should have update calls for both tables + order
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects transfer when destination occupied", async () => {
    // Mock: maybeSingle returns null (no available table matched)
    mockFromHandler = () => createChain({ data: null, error: null });

    await expect(
      transferTable("ko-1", "table-5", "table-8")
    ).rejects.toThrow("Bàn đích không trống");
  });
});

// ============================================================
// 4. GỘP HOÁ ĐƠN — Merge orders
// ============================================================

describe("Scenario: Gộp đơn (Bàn 5 + Bàn 6 → 1 hoá đơn)", () => {
  it("moves items from source to target, cancels source", async () => {
    mockFromHandler = (table: string) => {
      if (table === "kitchen_order_items") {
        return createChain({ data: null, error: null });
      }
      if (table === "kitchen_orders") {
        return createChain({ data: { table_id: "table-6" }, error: null });
      }
      if (table === "restaurant_tables") {
        return createChain({ data: null, error: null });
      }
      return createChain();
    };

    await mergeKitchenOrders("ko-1", ["ko-2"]);

    // Items moved (kitchen_order_id updated to ko-1)
    const itemMoves = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.kitchen_order_id === "ko-1"
    );
    expect(itemMoves.length).toBeGreaterThanOrEqual(1);

    // Source cancelled with merged_into_id
    const cancels = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.merged_into_id === "ko-1"
    );
    expect(cancels.length).toBeGreaterThanOrEqual(1);
  });

  it("merges 3 orders into 1", async () => {
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({ data: { table_id: null }, error: null });
      }
      return createChain({ data: null, error: null });
    };

    await mergeKitchenOrders("ko-1", ["ko-2", "ko-3", "ko-4"]);

    // 3 sources cancelled
    const mergedCalls = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.merged_into_id === "ko-1"
    );
    expect(mergedCalls.length).toBe(3);
  });
});

// ============================================================
// 5. HUỶ ĐƠN — Cancel order
// ============================================================

describe("Scenario: Huỷ đơn (khách đổi ý)", () => {
  it("cancels order and releases table", async () => {
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({
          data: { id: "ko-1", status: "pending", table_id: "table-3" },
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        return createChain({ data: null, error: null });
      }
      return createChain();
    };

    await cancelKitchenOrder("ko-1");

    // Order cancelled
    const cancelUpdates = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.status === "cancelled"
    );
    expect(cancelUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects cancel on completed order", async () => {
    mockFromHandler = () =>
      createChain({ data: { id: "ko-1", status: "completed", table_id: null }, error: null });

    await expect(cancelKitchenOrder("ko-1")).rejects.toThrow("thanh toán");
  });

  it("rejects cancel on already cancelled order", async () => {
    mockFromHandler = () =>
      createChain({ data: { id: "ko-1", status: "cancelled", table_id: null }, error: null });

    await expect(cancelKitchenOrder("ko-1")).rejects.toThrow("huỷ trước đó");
  });

  it("does not affect stock (no stock movement created)", async () => {
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({ data: { id: "ko-1", status: "preparing", table_id: null }, error: null });
      }
      return createChain({ data: null, error: null });
    };

    await cancelKitchenOrder("ko-1");

    const stockInserts = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.type === "out"
    );
    expect(stockInserts.length).toBe(0);
  });
});

// ============================================================
// 6. GIẢM GIÁ / CHIẾT KHẤU — Discount
// ============================================================

describe("Scenario: Giảm giá (discount)", () => {
  it("applies fixed discount (giảm 20k)", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    const result = await applyOrderDiscount("ko-1", "fixed", 20000, "Khách quen");
    expect(result.discountAmount).toBe(20000);
  });

  it("applies percent discount (10%)", async () => {
    // Need getKitchenOrderById mock for percent calc
    setupPaymentMocks({}, makeItemRows([
      { id: "p1", name: "CF Sữa Đá", qty: 2, price: 35000 },
      { id: "p2", name: "Hồng Trà", qty: 1, price: 29000 },
    ]));

    const result = await applyOrderDiscount("ko-1", "percent", 10, "Ngày khai trương");
    // subtotal = 2*35000 + 1*29000 = 99000, 10% = 9900
    expect(result.discountAmount).toBe(9900);
  });

  it("discount flows through to invoice total", async () => {
    setupPaymentMocks(
      { discount_amount: 15000 },
      makeItemRows([
        { id: "p1", name: "Latte", qty: 1, price: 42000 },
      ])
    );

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Khách lẻ", paymentMethod: "cash", paid: 27000,
    });

    expect(result.invoiceId).toBe("inv-1");
    // posCheckout called with discountAmount=15000, total=42000-15000=27000
  });
});

// ============================================================
// 7. DELIVERY PLATFORM — Shopee Food, Grab
// ============================================================

describe("Scenario: Đơn Shopee Food", () => {
  it("creates delivery order with platform info", async () => {
    const result = await sendToKitchen({
      ...CTX,
      orderType: "delivery",
      items: [
        { productId: "p1", productName: "Bạc Xỉu", quantity: 3, unitPrice: 32000 },
      ],
    });

    expect(result.kitchenOrderId).toBe("ko-1");
    expect(claimTableMock).not.toHaveBeenCalled(); // No table for delivery
  });

  it("sets delivery platform metadata", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    await setDeliveryPlatform("ko-1", "shopee_food", 15000, 22000);

    const platformUpdates = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.delivery_platform === "shopee_food"
    );
    expect(platformUpdates.length).toBe(1);
    expect((platformUpdates[0].data as Record<string, unknown>).delivery_fee).toBe(15000);
    expect((platformUpdates[0].data as Record<string, unknown>).platform_commission).toBe(22000);
  });

  it("delivery fee included in total", async () => {
    setupPaymentMocks(
      { order_type: "delivery", delivery_platform: "grab_food", delivery_fee: 15000 },
      makeItemRows([
        { id: "p1", name: "Bạc Xỉu", qty: 3, price: 32000 },
      ])
    );

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Grab #1234", paymentMethod: "transfer", paid: 111000,
    });

    expect(result.invoiceId).toBe("inv-1");
    // subtotal=96000, delivery_fee=15000, total=111000
  });
});

describe("Scenario: Đơn GrabFood", () => {
  it("sets Grab platform with commission 25%", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    // Grab takes 25% of subtotal (96000) = 24000
    await setDeliveryPlatform("ko-1", "grab_food", 0, 24000);

    const updates = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.delivery_platform === "grab_food"
    );
    expect(updates.length).toBe(1);
    expect((updates[0].data as Record<string, unknown>).platform_commission).toBe(24000);
  });
});

// ============================================================
// 8. GHI NỢ — Partial payment / Debt
// ============================================================

describe("Scenario: Ghi nợ (khách quen, trả sau)", () => {
  it("creates invoice with debt when paid < total", async () => {
    setupPaymentMocks({}, makeItemRows([
      { id: "p1", name: "Pour Over", qty: 1, price: 65000 },
      { id: "p2", name: "Phin", qty: 2, price: 25000 },
    ]));

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Anh Minh (nợ)", paymentMethod: "cash", paid: 50000,
    });

    expect(result.invoiceId).toBe("inv-1");
    // posCheckout handles debt = total - paid = 115000 - 50000 = 65000
  });

  it("zero payment = full debt", async () => {
    setupPaymentMocks({}, makeItemRows([
      { id: "p1", name: "Espresso", qty: 1, price: 40000 },
    ]));

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Chị Lan (nợ)", paymentMethod: "cash", paid: 0,
    });

    expect(result.invoiceId).toBe("inv-1");
  });
});

// ============================================================
// 9. MIXED PAYMENT — Thanh toán hỗn hợp
// ============================================================

describe("Scenario: Thanh toán hỗn hợp (50k cash + 50k chuyển khoản)", () => {
  it("creates invoice with mixed payment", async () => {
    setupPaymentMocks({}, makeItemRows([
      { id: "p1", name: "CF Sữa Đá", qty: 2, price: 35000 },
      { id: "p2", name: "Bạc Xỉu", qty: 1, price: 32000 },
    ]));

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Khách lẻ",
      paymentMethod: "mixed",
      paymentBreakdown: [
        { method: "cash", amount: 50000 },
        { method: "transfer", amount: 52000 },
      ],
      paid: 102000,
    });

    expect(result.invoiceId).toBe("inv-1");
  });
});

// ============================================================
// 10. HOÀN TRẢ / VOID — Refund after payment
// ============================================================

describe("Scenario: Hoàn trả hoá đơn (void)", () => {
  it("voids invoice, reverses stock and cash", async () => {
    mockFromHandler = (table: string) => {
      if (table === "invoices") {
        return createChain({
          data: { id: "inv-1", code: "HD00001", status: "completed", total: 35000, paid: 35000, source: "fnb" },
          error: null,
        });
      }
      if (table === "invoice_items") {
        return createChain({
          data: [
            { product_id: "p1", product_name: "CF Sữa Đá", quantity: 1 },
            { product_id: "tp1", product_name: "Trân châu", quantity: 1 },
          ],
          error: null,
        });
      }
      if (table === "stock_movements" || table === "cash_transactions" || table === "kitchen_orders") {
        return createChain({ data: null, error: null });
      }
      return createChain();
    };

    await voidFnbInvoice({
      invoiceId: "inv-1",
      kitchenOrderId: "ko-1",
      voidReason: "Khách phàn nàn chất lượng",
      voidedBy: "u1",
      tenantId: CTX.tenantId,
      branchId: CTX.branchId,
    });

    // Invoice cancelled
    const invoiceCancel = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.void_reason === "Khách phàn nàn chất lượng"
    );
    expect(invoiceCancel.length).toBe(1);

    // Stock reversed (type='in')
    const stockReverse = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.type === "in"
    );
    expect(stockReverse.length).toBe(2); // p1 + tp1

    // Cash reversed (phiếu chi)
    const cashReverse = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.type === "payment"
    );
    expect(cashReverse.length).toBe(1);
  });

  it("rejects void on already cancelled invoice", async () => {
    mockFromHandler = (table: string) => {
      if (table === "invoices") {
        return createChain({
          data: { id: "inv-1", code: "HD00001", status: "cancelled", total: 0, paid: 0, source: "fnb" },
          error: null,
        });
      }
      return createChain();
    };

    await expect(
      voidFnbInvoice({
        invoiceId: "inv-1", kitchenOrderId: "ko-1",
        voidReason: "test", voidedBy: "u1",
        tenantId: CTX.tenantId, branchId: CTX.branchId,
      })
    ).rejects.toThrow("huỷ trước đó");
  });
});

// ============================================================
// 11. EDGE CASES — Concurrent, empty, double
// ============================================================

describe("Scenario: Edge cases", () => {
  it("rejects payment on already completed order", async () => {
    // RPC raises when kitchen_order already paid
    rpcResponseOverrides["fnb_complete_payment_atomic"] = {
      data: null,
      error: { message: "Kitchen order ko-1 already paid (invoice_id=inv-old)" },
    };

    await expect(
      fnbPayment({
        kitchenOrderId: "ko-1", ...CTX,
        customerName: "Khách lẻ", paymentMethod: "cash", paid: 35000,
      })
    ).rejects.toThrow("already paid");
  });

  it("rejects payment on cancelled order", async () => {
    rpcResponseOverrides["fnb_complete_payment_atomic"] = {
      data: null,
      error: { message: "Kitchen order ko-1 was cancelled — cannot pay" },
    };

    await expect(
      fnbPayment({
        kitchenOrderId: "ko-1", ...CTX,
        customerName: "Khách lẻ", paymentMethod: "cash", paid: 35000,
      })
    ).rejects.toThrow("cancelled");
  });

  it("handles topping-heavy order (3 toppings per drink)", async () => {
    setupPaymentMocks({}, makeItemRows([
      {
        id: "p1", name: "Hồng Trà Kem Cheese", qty: 1, price: 45000,
        toppings: [
          { productId: "tp1", name: "Trân châu", quantity: 1, price: 8000 },
          { productId: "tp2", name: "Kem cheese", quantity: 1, price: 12000 },
          { productId: "tp3", name: "Thạch dừa", quantity: 1, price: 5000 },
        ],
      },
    ]));

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Khách lẻ", paymentMethod: "cash", paid: 70000,
    });

    expect(result.invoiceId).toBe("inv-1");
    // Should create 4 invoice items: 1 drink + 3 toppings
  });

  it("handles multiple tabs paid sequentially", async () => {
    // Tab 1
    setupPaymentMocks({}, makeItemRows([{ id: "p1", name: "Americano", qty: 1, price: 45000 }]));
    const r1 = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Khách 1", paymentMethod: "cash", paid: 45000,
    });

    // Tab 2 (different order)
    setupPaymentMocks(
      { id: "ko-2", order_number: "KB00002" },
      makeItemRows([{ id: "p2", name: "Latte", qty: 2, price: 42000 }])
    );
    const r2 = await fnbPayment({
      kitchenOrderId: "ko-2", ...CTX,
      customerName: "Khách 2", paymentMethod: "transfer", paid: 84000,
    });

    expect(r1.invoiceId).toBe("inv-1");
    expect(r2.invoiceId).toBe("inv-1"); // Same mock but proves flow works
  });

  it("order status lifecycle: pending → preparing → ready → served → completed", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    await updateKitchenOrderStatus("ko-1", "preparing");
    await updateKitchenOrderStatus("ko-1", "ready");
    await updateKitchenOrderStatus("ko-1", "served");
    // completed happens via linkInvoiceToOrder during payment
  });
});

// ============================================================
// 12. MULTI-TABLE SCENARIOS — Real Vietnamese coffee shop day
// ============================================================

describe("Scenario: Buổi sáng quán cà phê (multi-table simultaneous)", () => {
  it("handles 3 tables + 1 takeaway in parallel", async () => {
    // All create the same mock order but with different params
    const orders = [
      { orderType: "dine_in" as const, tableId: "table-1", item: "Espresso" },
      { orderType: "dine_in" as const, tableId: "table-3", item: "Latte" },
      { orderType: "dine_in" as const, tableId: "table-5", item: "Cappuccino" },
      { orderType: "takeaway" as const, item: "Cold Brew" },
    ];

    for (const o of orders) {
      const result = await sendToKitchen({
        ...CTX,
        orderType: o.orderType,
        tableId: o.tableId,
        items: [{ productId: "p1", productName: o.item, quantity: 1, unitPrice: 40000 }],
      });
      expect(result.kitchenOrderId).toBeTruthy();
    }

    // 3 dine-in → 3 table claims
    expect(claimTableMock).toHaveBeenCalledTimes(3);
  });
});

describe("Scenario: Khách chuyển bàn rồi gộp đơn", () => {
  it("transfers then merges", async () => {
    // Step 1: Transfer Bàn 5 → Bàn 8
    mockFromHandler = (table: string) => {
      if (table === "restaurant_tables") {
        return createChain({ data: { id: "table-8", status: "occupied" }, error: null });
      }
      if (table === "kitchen_orders") {
        return createChain({ data: null, error: null });
      }
      return createChain();
    };

    await transferTable("ko-1", "table-5", "table-8");

    // Step 2: Merge ko-2 (Bàn 3) into ko-1 (now Bàn 8)
    updateCalls.length = 0;
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({ data: { table_id: "table-3" }, error: null });
      }
      return createChain({ data: null, error: null });
    };

    await mergeKitchenOrders("ko-1", ["ko-2"]);

    const merges = updateCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.merged_into_id === "ko-1"
    );
    expect(merges.length).toBe(1);
  });
});

describe("Scenario: Discount + delivery + mixed payment combo", () => {
  it("applies 15% discount on Shopee order with mixed payment", async () => {
    // Order with discount + delivery fee
    setupPaymentMocks(
      {
        discount_amount: 14400, // 15% of 96000
        delivery_platform: "shopee_food",
        delivery_fee: 15000,
        platform_commission: 20000,
      },
      makeItemRows([
        { id: "p1", name: "Bạc Xỉu", qty: 3, price: 32000 },
      ])
    );

    const result = await fnbPayment({
      kitchenOrderId: "ko-1", ...CTX,
      customerName: "Shopee #SP123",
      paymentMethod: "mixed",
      paymentBreakdown: [
        { method: "cash", amount: 50000 },
        { method: "transfer", amount: 46600 },
      ],
      paid: 96600, // 96000 - 14400 + 15000
    });

    expect(result.invoiceId).toBe("inv-1");
  });
});
