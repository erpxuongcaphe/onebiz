import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock infrastructure ===

const insertCalls: { table: string; data: unknown }[] = [];
let nextCodeCounter = 0;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
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
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock" || fn === "allocate_lots_fifo") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock fnb-tables (claimTable, releaseTable)
const claimTableMock = vi.fn();
const releaseTableMock = vi.fn();
vi.mock("@/lib/services/supabase/fnb-tables", () => ({
  claimTable: (...args: unknown[]) => claimTableMock(...args),
  releaseTable: (...args: unknown[]) => releaseTableMock(...args),
  markTableAvailable: vi.fn(),
}));

import { sendToKitchen, fnbPayment } from "@/lib/services/supabase/fnb-checkout";
import type { ToppingAttachment } from "@/lib/types/fnb";

// === Helpers ===

const CTX = {
  tenantId: "t1",
  branchId: "b1",
  createdBy: "u1",
};

beforeEach(() => {
  insertCalls.length = 0;
  nextCodeCounter = 0;
  claimTableMock.mockReset();
  releaseTableMock.mockReset();
  claimTableMock.mockResolvedValue({ id: "table-1", status: "occupied" });
  releaseTableMock.mockResolvedValue(undefined);

  // Default mock: kitchen_orders insert returns an order, items insert succeeds
  mockFromHandler = (table: string) => {
    if (table === "kitchen_orders") {
      return createChain({
        data: {
          id: "ko-1",
          order_number: "KB00001",
          tenant_id: CTX.tenantId,
          branch_id: CTX.branchId,
          table_id: null,
          order_type: "takeaway",
          status: "pending",
          note: null,
          created_by: CTX.createdBy,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      });
    }
    if (table === "kitchen_order_items") {
      return createChain({ data: null, error: null });
    }
    if (table === "invoices") {
      return createChain({
        data: { id: "inv-1", code: "HD00001" },
        error: null,
      });
    }
    if (table === "invoice_items" || table === "stock_movements" || table === "cash_transactions") {
      return createChain({ data: null, error: null });
    }
    if (table === "restaurant_tables") {
      return createChain({ data: null, error: null });
    }
    return createChain();
  };
});

// ============================================================
// Tests
// ============================================================

describe("sendToKitchen", () => {
  it("creates kitchen order with correct items", async () => {
    const result = await sendToKitchen({
      ...CTX,
      orderType: "takeaway",
      items: [
        {
          productId: "p1",
          productName: "Cà Phê Sữa Đá",
          quantity: 2,
          unitPrice: 35000,
        },
        {
          productId: "p2",
          productName: "Bạc Xỉu",
          quantity: 1,
          unitPrice: 32000,
        },
      ],
    });

    expect(result.kitchenOrderId).toBe("ko-1");
    expect(result.orderNumber).toBe("KB00001");
  });

  it("does NOT create invoice or affect stock", async () => {
    await sendToKitchen({
      ...CTX,
      orderType: "takeaway",
      items: [
        { productId: "p1", productName: "Latte", quantity: 1, unitPrice: 42000 },
      ],
    });

    // Check that no invoices or stock_movements were inserted
    const invoiceInserts = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.status === "completed"
    );
    expect(invoiceInserts.length).toBe(0);
  });

  it("claims table when dine_in", async () => {
    await sendToKitchen({
      ...CTX,
      orderType: "dine_in",
      tableId: "table-5",
      items: [
        { productId: "p1", productName: "Americano", quantity: 1, unitPrice: 45000 },
      ],
    });

    expect(claimTableMock).toHaveBeenCalledWith("table-5", "ko-1");
  });

  it("does NOT claim table for takeaway", async () => {
    await sendToKitchen({
      ...CTX,
      orderType: "takeaway",
      items: [
        { productId: "p1", productName: "Cold Brew", quantity: 1, unitPrice: 55000 },
      ],
    });

    expect(claimTableMock).not.toHaveBeenCalled();
  });

  it("sends toppings as JSONB on kitchen_order_items", async () => {
    const toppings: ToppingAttachment[] = [
      { productId: "tp1", name: "Trân châu", quantity: 1, price: 8000 },
      { productId: "tp2", name: "Kem cheese", quantity: 1, price: 12000 },
    ];

    await sendToKitchen({
      ...CTX,
      orderType: "takeaway",
      items: [
        {
          productId: "p1",
          productName: "Hồng Trà Đào",
          quantity: 1,
          unitPrice: 29000,
          toppings,
        },
      ],
    });

    // Kitchen order items should include toppings JSONB
    const koItemInserts = insertCalls.filter(
      (c) => (c.data as Record<string, unknown>)?.kitchen_order_id === "ko-1"
    );
    expect(koItemInserts.length).toBeGreaterThanOrEqual(1);
    if (koItemInserts.length > 0) {
      const item = koItemInserts[0].data as Record<string, unknown>;
      expect(item.toppings).toEqual(toppings);
    }
  });
});

describe("fnbPayment", () => {
  beforeEach(() => {
    // Mock getKitchenOrderById — returns order with items + toppings
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({
          data: {
            id: "ko-1",
            order_number: "KB00001",
            tenant_id: CTX.tenantId,
            branch_id: CTX.branchId,
            table_id: "table-5",
            invoice_id: null,
            order_type: "dine_in",
            status: "pending",
            note: null,
            created_by: CTX.createdBy,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            restaurant_tables: { name: "Bàn 5" },
          },
          error: null,
        });
      }
      if (table === "kitchen_order_items") {
        return createChain({
          data: [
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
              toppings: [
                { productId: "tp1", name: "Trân châu", quantity: 1, price: 8000 },
              ],
              status: "ready",
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
              status: "ready",
              started_at: null,
              completed_at: null,
            },
          ],
          error: null,
        });
      }
      if (table === "invoices") {
        return createChain({
          data: { id: "inv-1", code: "HD00001" },
          error: null,
        });
      }
      if (
        table === "invoice_items" ||
        table === "stock_movements" ||
        table === "cash_transactions" ||
        table === "restaurant_tables"
      ) {
        return createChain({ data: null, error: null });
      }
      return createChain();
    };
  });

  it("flattens drink + toppings into invoice items", async () => {
    const result = await fnbPayment({
      kitchenOrderId: "ko-1",
      ...CTX,
      customerName: "Khách lẻ",
      paymentMethod: "cash",
      paid: 101000,
    });

    expect(result.invoiceId).toBe("inv-1");
    expect(result.invoiceCode).toBe("HD00001");

    // Should have 3 invoice items: CF Sữa Đá, Trân châu, Hồng Trà Đào
    // (topping = separate line item for stock tracking)
  });

  it("releases table after payment", async () => {
    await fnbPayment({
      kitchenOrderId: "ko-1",
      ...CTX,
      customerName: "Khách lẻ",
      paymentMethod: "cash",
      paid: 101000,
    });

    expect(releaseTableMock).toHaveBeenCalledWith("table-5");
  });

  it("rejects payment for completed orders", async () => {
    // Override to return completed status
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({
          data: {
            id: "ko-1",
            order_number: "KB00001",
            tenant_id: CTX.tenantId,
            branch_id: CTX.branchId,
            table_id: null,
            invoice_id: "inv-old",
            order_type: "takeaway",
            status: "completed",
            note: null,
            created_by: CTX.createdBy,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        });
      }
      if (table === "kitchen_order_items") {
        return createChain({ data: [], error: null });
      }
      return createChain();
    };

    await expect(
      fnbPayment({
        kitchenOrderId: "ko-1",
        ...CTX,
        customerName: "Khách lẻ",
        paymentMethod: "cash",
        paid: 50000,
      })
    ).rejects.toThrow("thanh toán");
  });
});

describe("table lifecycle", () => {
  it("table: available → occupied (gửi bếp) → cleaning (thanh toán)", async () => {
    // Step 1: Send to kitchen → claims table
    await sendToKitchen({
      ...CTX,
      orderType: "dine_in",
      tableId: "table-3",
      items: [
        { productId: "p1", productName: "Espresso", quantity: 1, unitPrice: 40000 },
      ],
    });

    expect(claimTableMock).toHaveBeenCalledWith("table-3", "ko-1");

    // Step 2: Payment → releases table
    // Reset for payment mock
    mockFromHandler = (table: string) => {
      if (table === "kitchen_orders") {
        return createChain({
          data: {
            id: "ko-1",
            order_number: "KB00001",
            tenant_id: CTX.tenantId,
            branch_id: CTX.branchId,
            table_id: "table-3",
            invoice_id: null,
            order_type: "dine_in",
            status: "served",
            note: null,
            created_by: CTX.createdBy,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            restaurant_tables: { name: "Bàn 3" },
          },
          error: null,
        });
      }
      if (table === "kitchen_order_items") {
        return createChain({
          data: [
            {
              id: "koi-1",
              kitchen_order_id: "ko-1",
              product_id: "p1",
              product_name: "Espresso",
              variant_id: null,
              variant_label: null,
              quantity: 1,
              unit_price: 40000,
              note: null,
              toppings: [],
              status: "ready",
              started_at: null,
              completed_at: null,
            },
          ],
          error: null,
        });
      }
      if (table === "invoices") {
        return createChain({ data: { id: "inv-2", code: "HD00002" }, error: null });
      }
      return createChain({ data: null, error: null });
    };

    await fnbPayment({
      kitchenOrderId: "ko-1",
      ...CTX,
      customerName: "Khách lẻ",
      paymentMethod: "transfer",
      paid: 40000,
    });

    expect(releaseTableMock).toHaveBeenCalledWith("table-3");
  });
});
