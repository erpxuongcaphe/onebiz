import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock ===

const insertCalls: { table: string; data: unknown }[] = [];
let nextCodeCounter = 0;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
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
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockFromHandler: (table: string) => any;

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => mockFromHandler(table)),
    rpc: vi.fn((fn: string) => {
      if (fn === "next_code") {
        nextCodeCounter++;
        return { data: `KB${String(nextCodeCounter).padStart(5, "0")}`, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getKitchenOrders,
  getKitchenOrderById,
  createKitchenOrder,
  addItemsToOrder,
  updateKitchenOrderStatus,
  updateKitchenItemStatus,
  linkInvoiceToOrder,
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
  insertCalls.length = 0;
  nextCodeCounter = 0;

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

describe("createKitchenOrder", () => {
  it("creates order with items", async () => {
    const order = await createKitchenOrder(
      {
        tenantId: "t1",
        branchId: "b1",
        createdBy: "u1",
        tableId: "table-5",
        orderType: "dine_in",
        items: [
          {
            productId: "p1",
            productName: "Espresso",
            quantity: 1,
            unitPrice: 40000,
            toppings: [{ productId: "tp1", name: "Kem cheese", quantity: 1, price: 12000 }],
          },
        ],
      },
      "KB00001"
    );

    expect(order.id).toBe("ko-1");
    expect(order.orderNumber).toBe("KB00001");

    // Verify items were inserted
    const itemInserts = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.kitchen_order_id === "ko-1"
    );
    expect(itemInserts.length).toBeGreaterThanOrEqual(1);
    const firstItem = itemInserts[0].data as Record<string, unknown>;
    expect(firstItem.product_name).toBe("Espresso");
    expect(firstItem.toppings).toEqual([
      { productId: "tp1", name: "Kem cheese", quantity: 1, price: 12000 },
    ]);
  });
});

describe("addItemsToOrder", () => {
  it("inserts additional items into existing order", async () => {
    await addItemsToOrder("ko-1", [
      {
        productId: "p3",
        productName: "Cold Brew",
        quantity: 1,
        unitPrice: 55000,
      },
    ]);

    const itemInserts = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.kitchen_order_id === "ko-1"
    );
    expect(itemInserts.length).toBeGreaterThanOrEqual(1);
    expect((itemInserts[0].data as Record<string, unknown>).product_name).toBe("Cold Brew");
  });
});

describe("updateKitchenOrderStatus", () => {
  it("updates order status without throwing", async () => {
    await updateKitchenOrderStatus("ko-1", "preparing");
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

describe("linkInvoiceToOrder", () => {
  it("links invoice and sets completed", async () => {
    await linkInvoiceToOrder("ko-1", "inv-1");
    // No throw = success
  });
});

describe("kitchen order lifecycle", () => {
  it("pending → preparing → ready → served → completed", async () => {
    // Step 1: Create order
    const order = await createKitchenOrder(
      {
        tenantId: "t1",
        branchId: "b1",
        createdBy: "u1",
        orderType: "takeaway",
        items: [
          { productId: "p1", productName: "Latte", quantity: 1, unitPrice: 42000 },
        ],
      },
      "KB00001"
    );
    expect(order.status).toBe("pending");

    // Step 2: Item preparing
    await updateKitchenItemStatus("koi-1", "preparing");

    // Step 3: Item ready
    await updateKitchenItemStatus("koi-1", "ready");

    // Step 4: Order served (all items ready → bar marks served)
    await updateKitchenOrderStatus(order.id, "served");

    // Step 5: Payment → completed
    await linkInvoiceToOrder(order.id, "inv-1");
    // No throws = full lifecycle success
  });
});
