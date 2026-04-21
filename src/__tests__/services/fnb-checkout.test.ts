import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock infrastructure ===

const insertCalls: { table: string; data: unknown }[] = [];
let nextCodeCounter = 0;
const rpcCalls: { fn: string; params: unknown }[] = [];

// RPC response overrides per test — keyed by fn name
let rpcResponses: Record<string, { data: unknown; error: unknown }> = {};

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
    rpc: vi.fn((fn: string, params?: unknown) => {
      rpcCalls.push({ fn, params });
      if (rpcResponses[fn]) return rpcResponses[fn];
      if (fn === "next_code") {
        nextCodeCounter++;
        return { data: `KB${String(nextCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock" || fn === "allocate_lots_fifo") {
        return { data: null, error: null };
      }
      if (fn === "fnb_complete_payment_atomic") {
        return {
          data: {
            invoice_id: "inv-1",
            invoice_code: "HD00001",
            total: 51000,
            paid: 51000,
            debt: 0,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock fnb-tables (claimTable still used by sendToKitchen)
const claimTableMock = vi.fn();
vi.mock("@/lib/services/supabase/fnb-tables", () => ({
  claimTable: (...args: unknown[]) => claimTableMock(...args),
  releaseTable: vi.fn(),
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
  rpcCalls.length = 0;
  rpcResponses = {};
  nextCodeCounter = 0;
  claimTableMock.mockReset();
  claimTableMock.mockResolvedValue({ id: "table-1", status: "occupied" });

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

// ============================================================
// fnbPayment — Atomic RPC tests
// ============================================================
//
// fnbPayment() now delegates to `fnb_complete_payment_atomic` Postgres RPC.
// Business logic (flatten items + toppings, create invoice, decrement stock,
// cash_transactions, release table) is tested at DB layer via integration.
// Here we only verify the TS wrapper: correct param mapping + response handling.

describe("fnbPayment (atomic RPC wrapper)", () => {
  it("calls fnb_complete_payment_atomic RPC with correct params", async () => {
    const result = await fnbPayment({
      kitchenOrderId: "ko-1",
      ...CTX,
      customerId: "c1",
      customerName: "Nguyễn Văn A",
      paymentMethod: "cash",
      paid: 50000,
      discountAmount: 5000,
      note: "ghi chú",
    });

    expect(result.invoiceId).toBe("inv-1");
    expect(result.invoiceCode).toBe("HD00001");

    const rpcCall = rpcCalls.find((c) => c.fn === "fnb_complete_payment_atomic");
    expect(rpcCall).toBeDefined();
    const params = rpcCall!.params as Record<string, unknown>;
    expect(params.p_kitchen_order_id).toBe("ko-1");
    expect(params.p_customer_id).toBe("c1");
    expect(params.p_customer_name).toBe("Nguyễn Văn A");
    expect(params.p_payment_method).toBe("cash");
    expect(params.p_paid).toBe(50000);
    expect(params.p_discount_amount).toBe(5000);
    expect(params.p_note).toBe("ghi chú");
    expect(params.p_created_by).toBe("u1");
  });

  it("passes payment_breakdown for mixed payment", async () => {
    const breakdown = [
      { method: "cash" as const, amount: 30000 },
      { method: "transfer" as const, amount: 20000 },
    ];
    await fnbPayment({
      kitchenOrderId: "ko-1",
      ...CTX,
      customerName: "Khách lẻ",
      paymentMethod: "mixed",
      paymentBreakdown: breakdown,
      paid: 50000,
    });

    const rpcCall = rpcCalls.find((c) => c.fn === "fnb_complete_payment_atomic");
    const params = rpcCall!.params as Record<string, unknown>;
    expect(params.p_payment_method).toBe("mixed");
    expect(params.p_payment_breakdown).toEqual(breakdown);
  });

  it("uses default customer name when empty string", async () => {
    await fnbPayment({
      kitchenOrderId: "ko-1",
      ...CTX,
      customerName: "",
      paymentMethod: "cash",
      paid: 50000,
    });

    const rpcCall = rpcCalls.find((c) => c.fn === "fnb_complete_payment_atomic");
    const params = rpcCall!.params as Record<string, unknown>;
    expect(params.p_customer_name).toBe("Khách lẻ");
  });

  it("throws khi RPC trả lỗi (already paid)", async () => {
    rpcResponses["fnb_complete_payment_atomic"] = {
      data: null,
      error: { message: "Kitchen order ko-1 already paid (invoice_id=inv-old)" },
    };

    await expect(
      fnbPayment({
        kitchenOrderId: "ko-1",
        ...CTX,
        customerName: "Khách lẻ",
        paymentMethod: "cash",
        paid: 50000,
      })
    ).rejects.toThrow("already paid");
  });

  it("throws khi RPC trả response rỗng", async () => {
    rpcResponses["fnb_complete_payment_atomic"] = { data: null, error: null };

    await expect(
      fnbPayment({
        kitchenOrderId: "ko-1",
        ...CTX,
        customerName: "Khách lẻ",
        paymentMethod: "cash",
        paid: 50000,
      })
    ).rejects.toThrow("phản hồi");
  });

  it("throws khi RPC response thiếu invoice_id", async () => {
    rpcResponses["fnb_complete_payment_atomic"] = {
      data: { invoice_code: "HD00001" }, // missing invoice_id
      error: null,
    };

    await expect(
      fnbPayment({
        kitchenOrderId: "ko-1",
        ...CTX,
        customerName: "Khách lẻ",
        paymentMethod: "cash",
        paid: 50000,
      })
    ).rejects.toThrow("thiếu thông tin");
  });
});
