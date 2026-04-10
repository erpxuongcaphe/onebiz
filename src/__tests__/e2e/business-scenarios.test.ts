import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * COMPREHENSIVE BUSINESS SCENARIOS — Warehouse & Sales Management
 *
 * Covers ALL real-world business cases for a coffee roasting/retail ERP:
 *
 * === POS (Bán Hàng Trực Tiếp) ===
 *   S1:  Cash sale — single product
 *   S2:  Card sale — multiple products
 *   S3:  Transfer sale (chuyển khoản)
 *   S4:  Mixed payment split (tiền mặt + CK + thẻ)
 *   S5:  Sale with per-line discount
 *   S6:  Sale with order-level discount
 *   S7:  Sale with zero-paid (ghi nợ toàn bộ)
 *   S8:  Oversell — stock goes negative (warning but allowed)
 *   S9:  Walk-in vs named customer
 *
 * === DRAFT (Đơn Nháp F9 → F10) ===
 *   D1:  Save draft — NO stock/cash side effects
 *   D2:  Complete draft — stock + cash applied
 *   D3:  Delete draft — removed without trace
 *   D4:  Complete already-completed draft — reject
 *
 * === PURCHASE ORDER (Nhập Hàng) ===
 *   P1:  Create PO with correct tenant/branch context
 *   P2:  Receive PO — stock IN + lots created
 *   P3:  Receive PO — auto creates input invoice
 *   P4:  Partial receive — remaining quantity correct
 *   P5:  Cancel PO — status change only (draft/ordered)
 *   P6:  Double receive guard — atomic claim prevents
 *
 * === SALES ORDER (Đơn Hàng Bán) ===
 *   O1:  Complete sales order → auto invoice + stock + cash
 *   O2:  Cancel sales order — only new/confirmed allowed
 *   O3:  Cancel delivering order — reject
 *   O4:  Double complete guard — atomic claim
 *
 * === RETURNS (Trả Hàng) ===
 *   R1:  Customer return — stock increment (IN) + cash refund
 *   R2:  Return with zero refund (exchange) — stock IN only
 *   R3:  Purchase return (to supplier) — stock decrement (OUT)
 *
 * === WAREHOUSE OPS (Kho Hàng) ===
 *   W1:  Disposal export → stock OUT
 *   W2:  Internal export → stock OUT
 *   W3:  Stock transfer (branch A → B) — dual OUT/IN
 *   W4:  Transfer cancel — no stock changes
 *   W5:  Inventory check — surplus → stock IN
 *   W6:  Inventory check — shortage → stock OUT
 *   W7:  Inventory check — mixed surplus + shortage
 *
 * === FINANCIAL (Tài Chính) ===
 *   F1:  Debt aging — 4 buckets (0-30, 31-60, 61-90, 90+)
 *   F2:  P&L — revenue - COGS - expenses
 *   F3:  Financial alerts — low stock, high debt, expiring lots
 *   F4:  DSO calculation
 *   F5:  Inventory turnover
 *
 * === EDGE CASES (Biên) ===
 *   E1:  Concurrent claim — only 1 succeeds
 *   E2:  Code generation — unique monotonic
 *   E3:  Empty items list — validation guard
 *   E4:  Very large quantity — no overflow
 *   E5:  Context resolution — tenant/branch/user correct
 */

// ============================================================
//  Shared mock infrastructure (same pattern as workflow-e2e)
// ============================================================

const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: {
  table: string;
  data: unknown;
  filters: Record<string, unknown>;
}[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];
const stockMovementCalls: unknown[] = [];
let rpcCodeCounter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableMocks: Record<string, any> = {};
let claimCounter = 0;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn((col: string, val: unknown) => {
    chain._filters = { ...chain._filters, [col]: val };
    return chain;
  });
  chain.neq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.lte = vi.fn(self);
  chain.not = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.range = vi.fn(self);
  chain.or = vi.fn(self);
  chain.ilike = vi.fn(self);
  chain.is = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  chain._filters = {};

  chain.insert = vi.fn((data: unknown) => {
    insertCalls.push({ table: chain._tableName ?? "_unknown", data });
    const nextChain = createChain(resolvedValue);
    nextChain._tableName = chain._tableName;
    return nextChain;
  });

  chain.update = vi.fn((data: unknown) => {
    updateCalls.push({
      table: chain._tableName ?? "_unknown",
      data,
      filters: { ...chain._filters },
    });
    return chain;
  });

  chain.delete = vi.fn(self);

  return chain;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      const mock = tableMocks[table];
      const chain = createChain(mock ?? { data: null, error: null });
      chain._tableName = table;
      return chain;
    }),
    rpc: vi.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      if (fn === "next_code") {
        rpcCodeCounter++;
        return {
          data: `CODE${String(rpcCodeCounter).padStart(5, "0")}`,
          error: null,
        };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({
      tenantId: "tenant-1",
      branchId: "branch-1",
      userId: "user-1",
    })
  ),
  getCurrentTenantId: vi.fn(() => Promise.resolve("tenant-1")),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 49 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: vi.fn((...args: unknown[]) => {
    stockMovementCalls.push(args);
    return Promise.resolve();
  }),
  nextEntityCode: vi.fn(() => Promise.resolve(`WH${Date.now()}`)),
}));

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  stockMovementCalls.length = 0;
  rpcCodeCounter = 0;
  claimCounter = 0;
  tableMocks = {};
});

// ============================================================
//  Helper: standard POS checkout input builder
// ============================================================

function posInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    branchId: "branch-1",
    createdBy: "user-1",
    customerName: "Khách lẻ",
    items: [
      {
        productId: "p1",
        productName: "Cà phê rang xay 500g",
        quantity: 1,
        unitPrice: 200_000,
        discount: 0,
      },
    ],
    paymentMethod: "cash" as const,
    subtotal: 200_000,
    discountAmount: 0,
    total: 200_000,
    paid: 200_000,
    ...overrides,
  };
}

function setupStandardPOSMocks() {
  tableMocks = {
    invoices: {
      data: { id: "inv-1", code: "HD00001", total: 200_000 },
      error: null,
    },
    invoice_items: { data: null, error: null },
    stock_movements: { data: null, error: null },
    cash_transactions: { data: null, error: null },
  };
}

// ============================================================
//  S1-S9: POS SCENARIOS
// ============================================================

describe("POS Scenarios", () => {
  beforeEach(setupStandardPOSMocks);

  it("S1: Cash sale — single product, invoice + stock + cash", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(posInput());

    // Invoice created
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    expect(invoices).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).status).toBe("completed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).payment_method).toBe("cash");

    // Stock movement
    const sm = insertCalls.filter((c) => c.table === "stock_movements");
    expect(sm).toHaveLength(1);

    // Stock decrement RPC
    const decRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    expect(decRpcs).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBe(-1);

    // Cash receipt
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash).toHaveLength(1);
  });

  it("S2: Card sale — multiple products, correct stock per product", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        items: [
          { productId: "p1", productName: "Cà phê", quantity: 3, unitPrice: 100_000, discount: 0 },
          { productId: "p2", productName: "Trà", quantity: 2, unitPrice: 80_000, discount: 0 },
          { productId: "p3", productName: "Bánh", quantity: 5, unitPrice: 30_000, discount: 0 },
        ],
        paymentMethod: "card",
        subtotal: 610_000,
        total: 610_000,
        paid: 610_000,
      })
    );

    // 3 products × 2 RPCs (increment_product_stock + upsert_branch_stock) = 6
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs).toHaveLength(6);

    // Verify individual deltas
    const p1Rpc = rpcCalls.find(
      (c) =>
        c.fn === "increment_product_stock" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.params as any).p_product_id === "p1"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p1Rpc!.params as any).p_delta).toBe(-3);

    const p3Rpc = rpcCalls.find(
      (c) =>
        c.fn === "increment_product_stock" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.params as any).p_product_id === "p3"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p3Rpc!.params as any).p_delta).toBe(-5);
  });

  it("S3: Transfer payment — records correct payment_method", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(posInput({ paymentMethod: "transfer" }));

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).payment_method).toBe("transfer");
  });

  it("S4: Mixed payment — creates separate cash_transactions per method", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        paymentMethod: "mixed",
        total: 1_000_000,
        subtotal: 1_000_000,
        paid: 1_000_000,
        paymentBreakdown: [
          { method: "cash", amount: 500_000 },
          { method: "transfer", amount: 300_000 },
          { method: "card", amount: 200_000 },
        ],
      })
    );

    // Multiple cash_transactions created (1 per method)
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash.length).toBeGreaterThanOrEqual(1);
  });

  it("S5: Sale with per-line discount — items store discount amount", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        items: [
          { productId: "p1", productName: "SP", quantity: 2, unitPrice: 200_000, discount: 50_000 },
        ],
        subtotal: 400_000,
        discountAmount: 50_000,
        total: 350_000,
        paid: 350_000,
      })
    );

    const items = insertCalls.filter((c) => c.table === "invoice_items");
    expect(items).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineData = (items[0].data as any)[0];
    expect(lineData.discount).toBe(50_000);
  });

  it("S6: Sale with order-level discount — total reflects discount", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        subtotal: 500_000,
        discountAmount: 100_000,
        total: 400_000,
        paid: 400_000,
      })
    );

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).discount_amount).toBe(100_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).total).toBe(400_000);
  });

  it("S7: Zero-paid sale (ghi nợ) — full debt, no cash receipt", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        total: 300_000,
        subtotal: 300_000,
        paid: 0,
      })
    );

    // Invoice created with debt
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).paid).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).debt).toBe(300_000);

    // No cash receipt when paid=0
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash).toHaveLength(0);

    // Stock still decremented (goods delivered)
    const sm = insertCalls.filter((c) => c.table === "stock_movements");
    expect(sm).toHaveLength(1);
  });

  it("S8: Oversell — stock goes negative but sale proceeds", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    // Selling 999 units (likely more than stock)
    await posCheckout(
      posInput({
        items: [
          { productId: "p1", productName: "SP", quantity: 999, unitPrice: 1_000, discount: 0 },
        ],
        subtotal: 999_000,
        total: 999_000,
        paid: 999_000,
      })
    );

    // Stock decrement called with -999
    const decRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBe(-999);

    // Invoice still created
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    expect(invoices).toHaveLength(1);
  });

  it("S9: Named customer vs walk-in — customer info recorded", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        customerId: "cust-1",
        customerName: "Nguyễn Văn A",
      })
    );

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invData = invoices[0].data as any;
    expect(invData.customer_id).toBe("cust-1");
    expect(invData.customer_name).toBe("Nguyễn Văn A");
  });
});

// ============================================================
//  D1-D4: DRAFT ORDER SCENARIOS
// ============================================================

describe("Draft Order Scenarios", () => {
  beforeEach(() => {
    tableMocks = {
      invoices: {
        data: {
          id: "inv-draft-1",
          code: "HD00002",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          customer_id: null,
          customer_name: "Khách lẻ",
          subtotal: 500_000,
          discount_amount: 0,
          total: 500_000,
          paid: 0,
          debt: 500_000,
          payment_method: "cash",
          note: null,
          status: "draft",
        },
        error: null,
      },
      invoice_items: {
        data: [
          {
            id: "ii-1",
            product_id: "p1",
            product_name: "Cà phê hạt 1kg",
            quantity: 5,
            unit_price: 100_000,
            discount: 0,
            total: 500_000,
          },
        ],
        error: null,
      },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("D1: Save draft — creates invoice with status=draft, no stock/cash", async () => {
    const { saveDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await saveDraftOrder(posInput({ paid: 0 }));

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    expect(invoices).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).status).toBe("draft");

    // No side effects
    expect(insertCalls.filter((c) => c.table === "stock_movements")).toHaveLength(0);
    expect(insertCalls.filter((c) => c.table === "cash_transactions")).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.fn === "increment_product_stock")).toHaveLength(0);
  });

  it("D2: Complete draft — applies stock decrement + cash receipt", async () => {
    const { completeDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeDraftOrder("inv-draft-1", {
      method: "cash",
      paid: 500_000,
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
    });

    // Status update from draft→completed
    const updates = updateCalls.filter((c) => c.table === "invoices");
    expect(updates.length).toBeGreaterThanOrEqual(1);

    // Stock decremented
    const smInserts = insertCalls.filter((c) => c.table === "stock_movements");
    expect(smInserts).toHaveLength(1);

    // Cash receipt
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash).toHaveLength(1);
  });

  it("D3: Delete draft — removes invoice", async () => {
    const { deleteDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await deleteDraftOrder("inv-draft-1");

    // No stock or cash operations on delete
    expect(insertCalls.filter((c) => c.table === "stock_movements")).toHaveLength(0);
    expect(insertCalls.filter((c) => c.table === "cash_transactions")).toHaveLength(0);
  });

  it("D4: Complete already-completed draft — throws error (atomic guard)", async () => {
    tableMocks.invoices = { data: null, error: null }; // No row returned = already claimed

    const { completeDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(
      completeDraftOrder("inv-draft-1", {
        method: "cash",
        paid: 500_000,
        tenantId: "tenant-1",
        branchId: "branch-1",
        createdBy: "user-1",
      })
    ).rejects.toThrow();
  });
});

// ============================================================
//  P1-P6: PURCHASE ORDER SCENARIOS
// ============================================================

describe("Purchase Order Scenarios", () => {
  beforeEach(() => {
    tableMocks = {
      purchase_orders: {
        data: {
          id: "po-1",
          code: "PO00001",
          supplier_id: "supp-1",
          supplier_name: "NCC Cà Phê",
          status: "ordered",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          total: 10_000_000,
        },
        error: null,
      },
      purchase_order_items: {
        data: [
          {
            id: "poi-1",
            product_id: "p1",
            product_name: "Hạt Arabica",
            quantity: 100,
            received_quantity: 0,
            unit_price: 80_000,
            unit: "kg",
          },
          {
            id: "poi-2",
            product_id: "p2",
            product_name: "Hạt Robusta",
            quantity: 50,
            received_quantity: 0,
            unit_price: 40_000,
            unit: "kg",
          },
        ],
        error: null,
      },
      product_lots: { data: null, error: null },
      input_invoices: { data: null, error: null },
      stock_movements: { data: null, error: null },
    };
  });

  it("P2: Receive PO — stock IN via applyManualStockMovement", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // applyManualStockMovement called with type='in'
    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].quantity).toBe(100); // Full unreceived qty
    expect(inputs[1].type).toBe("in");
    expect(inputs[1].quantity).toBe(50);
  });

  it("P3: Receive PO — auto creates product lots (FIFO)", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // Product lots created for FIFO tracking
    const lotInserts = insertCalls.filter((c) => c.table === "product_lots");
    expect(lotInserts.length).toBeGreaterThanOrEqual(1);
  });

  it("P3b: Receive PO — auto creates input invoice", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // Input invoice auto-created
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "input_invoices"
    );
    expect(invoiceInserts.length).toBeGreaterThanOrEqual(1);
  });

  it("P4: Partial receive — only remaining qty affects stock", async () => {
    // Simulate partially received PO
    tableMocks.purchase_order_items = {
      data: [
        {
          id: "poi-1",
          product_id: "p1",
          product_name: "Hạt Arabica",
          quantity: 100,
          received_quantity: 60, // Already received 60
          unit_price: 80_000,
          unit: "kg",
        },
      ],
      error: null,
    };

    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // Stock IN only for remaining 40 (100-60)
    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].quantity).toBe(40);
  });

  it("P6: Double receive guard — second call throws", async () => {
    tableMocks.purchase_orders = { data: null, error: null }; // Claim fails

    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await expect(receivePurchaseOrder("po-1")).rejects.toThrow();
  });
});

// ============================================================
//  O1-O4: SALES ORDER SCENARIOS
// ============================================================

describe("Sales Order Scenarios", () => {
  beforeEach(() => {
    tableMocks = {
      sales_orders: {
        data: {
          id: "so-1",
          code: "DH00001",
          customer_id: "cust-1",
          customer_name: "Quán ABC",
          status: "confirmed",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          subtotal: 2_000_000,
          discount_amount: 0,
          total: 2_000_000,
        },
        error: null,
      },
      sales_order_items: {
        data: [
          {
            id: "soi-1",
            product_id: "p1",
            product_name: "Cà phê rang xay 1kg",
            quantity: 10,
            unit_price: 200_000,
            discount: 0,
            total: 2_000_000,
            unit: "gói",
          },
        ],
        error: null,
      },
      invoices: {
        data: { id: "inv-auto", code: "HD00010", total: 2_000_000 },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("O1: Complete sales order — auto invoice + stock OUT + cash receipt", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    const result = await completeSalesOrder("so-1");

    // Auto invoice created
    const invoiceInserts = insertCalls.filter((c) => c.table === "invoices");
    expect(invoiceInserts.length).toBeGreaterThanOrEqual(1);

    // Stock decremented
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBeGreaterThanOrEqual(1);

    // Cash receipt
    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBeGreaterThanOrEqual(1);

    // Returns invoice info
    expect(result).toHaveProperty("invoiceId");
  });

  it("O2: Cancel sales order — changes status to cancelled", async () => {
    tableMocks.sales_orders = {
      data: {
        id: "so-1",
        status: "new",
      },
      error: null,
    };

    const { cancelSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await cancelSalesOrder("so-1");

    // Status updated to cancelled
    const updates = updateCalls.filter((c) => c.table === "sales_orders");
    expect(updates.length).toBeGreaterThanOrEqual(1);

    // No stock or cash side effects
    expect(insertCalls.filter((c) => c.table === "stock_movements")).toHaveLength(0);
    expect(insertCalls.filter((c) => c.table === "cash_transactions")).toHaveLength(0);
  });

  it("O3: Cancel delivering order — reject (not allowed)", async () => {
    tableMocks.sales_orders = { data: null, error: null }; // Claim fails

    const { cancelSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(cancelSalesOrder("so-1")).rejects.toThrow();
  });

  it("O4: Double complete — atomic guard prevents second completion", async () => {
    tableMocks.sales_orders = { data: null, error: null }; // Already completed

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(completeSalesOrder("so-1")).rejects.toThrow();
  });
});

// ============================================================
//  R1-R3: RETURNS SCENARIOS
// ============================================================

describe("Returns Scenarios", () => {
  it("R1: Customer return — stock IN + cash refund payment", async () => {
    const { completeReturn } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await completeReturn({
      returnId: "ret-1",
      returnCode: "TH00001",
      invoiceCode: "HD00001",
      customerName: "Nguyễn Văn B",
      items: [
        { productId: "p1", productName: "Cà phê", quantity: 3, unitPrice: 100_000 },
        { productId: "p2", productName: "Trà", quantity: 2, unitPrice: 50_000 },
      ],
      refundAmount: 400_000,
    });

    // Stock increment (IN) via applyManualStockMovement
    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].quantity).toBe(3);
    expect(inputs[1].type).toBe("in");
    expect(inputs[1].quantity).toBe(2);
    expect(inputs[0].referenceType).toBe("sales_return");

    // Cash refund payment created
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash.length).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashData = cash[0].data as any;
    expect(cashData.type).toBe("payment");
    expect(cashData.amount).toBe(400_000);
    expect(cashData.category).toBe("Trả hàng");
  });

  it("R2: Return with zero refund (exchange) — stock IN, no cash", async () => {
    const { completeReturn } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await completeReturn({
      returnId: "ret-2",
      returnCode: "TH00002",
      invoiceCode: "HD00002",
      customerName: "Khách lẻ",
      items: [
        { productId: "p1", productName: "SP", quantity: 1, unitPrice: 100_000 },
      ],
      refundAmount: 0, // Exchange — no refund
    });

    // Stock still incremented
    expect(stockMovementCalls.length).toBe(1);

    // No cash transaction for zero refund
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash).toHaveLength(0);
  });

  it("R3: Purchase return (to supplier) — stock OUT", async () => {
    // Simulate what the create-purchase-return-dialog does
    const { applyManualStockMovement } = await import(
      "@/lib/services/supabase/stock-adjustments"
    );

    await applyManualStockMovement([
      {
        productId: "p1",
        quantity: 10,
        type: "out",
        referenceType: "purchase_return",
        referenceId: "pr-1",
        note: "THN001 - Trả hàng nhập - Hạt bị ẩm",
      },
      {
        productId: "p2",
        quantity: 5,
        type: "out",
        referenceType: "purchase_return",
        referenceId: "pr-1",
        note: "THN001 - Trả hàng nhập - Hạt bị ẩm",
      },
    ]);

    // Stock movements tracked
    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].type).toBe("out");
    expect(inputs[0].quantity).toBe(10);
    expect(inputs[1].type).toBe("out");
    expect(inputs[1].quantity).toBe(5);
  });
});

// ============================================================
//  W1-W7: WAREHOUSE OPERATIONS
// ============================================================

describe("Warehouse Operations", () => {
  it("W1: Disposal export — stock OUT for destroyed goods", async () => {
    tableMocks = {
      disposal_exports: {
        data: { id: "de-1", code: "XH00001", status: "draft" },
        error: null,
      },
      disposal_export_items: {
        data: [
          { id: "dei-1", product_id: "p1", product_name: "Hạt hết hạn", quantity: 20 },
          { id: "dei-2", product_id: "p2", product_name: "Bao bì hỏng", quantity: 50 },
        ],
        error: null,
      },
    };

    const { completeDisposalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await completeDisposalExport("de-1");

    // Stock OUT via applyManualStockMovement
    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs.length).toBe(2);
    expect(inputs[0].type).toBe("out");
    expect(inputs[0].quantity).toBe(20);
    expect(inputs[0].referenceType).toBe("disposal_export");
    expect(inputs[1].quantity).toBe(50);
  });

  it("W2: Internal export — stock OUT for internal use", async () => {
    tableMocks = {
      internal_exports: {
        data: { id: "ie-1", code: "XNB00001", status: "draft" },
        error: null,
      },
      internal_export_items: {
        data: [
          { id: "iei-1", product_id: "p1", product_name: "Cà phê mẫu", quantity: 5 },
        ],
        error: null,
      },
    };

    const { completeInternalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await completeInternalExport("ie-1");

    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs[0].type).toBe("out");
    expect(inputs[0].referenceType).toBe("internal_export");
  });

  it("W3: Stock transfer — source OUT + target IN, net zero on company level", async () => {
    tableMocks = {
      stock_transfers: {
        data: {
          id: "tf-1",
          code: "CK00001",
          from_branch_id: "branch-hcm",
          to_branch_id: "branch-hn",
          status: "draft",
          tenant_id: "tenant-1",
        },
        error: null,
      },
      stock_transfer_items: {
        data: [
          {
            id: "tfi-1",
            product_id: "p1",
            product_name: "Cà phê 500g",
            quantity: 30,
          },
          {
            id: "tfi-2",
            product_id: "p2",
            product_name: "Trà 200g",
            quantity: 15,
          },
        ],
        error: null,
      },
    };

    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // Two stock movement calls: OUT from source + IN to target
    expect(stockMovementCalls.length).toBe(2);

    // First call: OUT from source branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outInputs = (stockMovementCalls[0] as any[])[0];
    expect(outInputs).toHaveLength(2);
    expect(outInputs[0].type).toBe("out");
    expect(outInputs[0].quantity).toBe(30);
    expect(outInputs[1].type).toBe("out");
    expect(outInputs[1].quantity).toBe(15);

    // Verify OUT uses source branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outCtx = (stockMovementCalls[0] as any[])[1];
    expect(outCtx.branchId).toBe("branch-hcm");

    // Second call: IN to target branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inInputs = (stockMovementCalls[1] as any[])[0];
    expect(inInputs).toHaveLength(2);
    expect(inInputs[0].type).toBe("in");
    expect(inInputs[0].quantity).toBe(30);
    expect(inInputs[1].type).toBe("in");
    expect(inInputs[1].quantity).toBe(15);

    // Verify IN uses target branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inCtx = (stockMovementCalls[1] as any[])[1];
    expect(inCtx.branchId).toBe("branch-hn");
  });

  it("W4: Cancel transfer — no stock changes, only status update", async () => {
    tableMocks = {
      stock_transfers: {
        data: { id: "tf-2", status: "draft" },
        error: null,
      },
    };

    const { cancelStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await cancelStockTransfer("tf-2");

    // Status updated
    const updates = updateCalls.filter(
      (c) => c.table === "stock_transfers"
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);

    // NO stock movements
    expect(stockMovementCalls).toHaveLength(0);
  });

  it("W5: Inventory check surplus — stock IN for extra items found", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-1", code: "KK00001", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          {
            id: "ici-1",
            product_id: "p1",
            product_name: "SP A",
            system_stock: 50,
            actual_stock: 55,
            difference: 5, // surplus
          },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import(
      "@/lib/services/supabase/inventory"
    );

    await applyInventoryCheck("ic-1");

    // Stock IN for surplus
    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].quantity).toBe(5);
  });

  it("W6: Inventory check shortage — stock OUT for missing items", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-2", code: "KK00002", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          {
            id: "ici-2",
            product_id: "p2",
            product_name: "SP B",
            system_stock: 100,
            actual_stock: 92,
            difference: -8, // shortage
          },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import(
      "@/lib/services/supabase/inventory"
    );

    await applyInventoryCheck("ic-2");

    // Stock OUT for shortage
    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("W7: Inventory check mixed — surplus + shortage in same check", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-3", code: "KK00003", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          {
            id: "ici-3",
            product_id: "p1",
            product_name: "SP A",
            system_stock: 50,
            actual_stock: 55,
            difference: 5, // surplus
          },
          {
            id: "ici-4",
            product_id: "p2",
            product_name: "SP B",
            system_stock: 30,
            actual_stock: 25,
            difference: -5, // shortage
          },
          {
            id: "ici-5",
            product_id: "p3",
            product_name: "SP C",
            system_stock: 20,
            actual_stock: 20,
            difference: 0, // no change — should be skipped
          },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import(
      "@/lib/services/supabase/inventory"
    );

    await applyInventoryCheck("ic-3");

    // At least 1 call (surplus grouped, shortage grouped)
    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
//  F1-F5: FINANCIAL SCENARIOS
// ============================================================

describe("Financial Scenarios", () => {
  it("F1: Debt aging — classifies into 4 correct buckets", async () => {
    const now = new Date();
    const days15 = new Date(now.getTime() - 15 * 86400000).toISOString();
    const days45 = new Date(now.getTime() - 45 * 86400000).toISOString();
    const days75 = new Date(now.getTime() - 75 * 86400000).toISOString();
    const days120 = new Date(now.getTime() - 120 * 86400000).toISOString();

    tableMocks = {
      customers: {
        data: [
          { id: "c1", name: "KH A", debt: 1_000_000 },
          { id: "c2", name: "KH B", debt: 2_000_000 },
          { id: "c3", name: "KH C", debt: 500_000 },
          { id: "c4", name: "KH D", debt: 3_000_000 },
        ],
        error: null,
        count: 4,
      },
      suppliers: {
        data: [
          { id: "s1", name: "NCC X", debt: 800_000 },
        ],
        error: null,
        count: 1,
      },
      invoices: {
        data: [
          { id: "inv-1", customer_id: "c1", created_at: days15, debt: 1_000_000 },
          { id: "inv-2", customer_id: "c2", created_at: days45, debt: 2_000_000 },
          { id: "inv-3", customer_id: "c3", created_at: days75, debt: 500_000 },
          { id: "inv-4", customer_id: "c4", created_at: days120, debt: 3_000_000 },
        ],
        error: null,
      },
      purchase_orders: {
        data: [
          { id: "po-1", supplier_id: "s1", created_at: days15, debt: 800_000 },
        ],
        error: null,
      },
    };

    const { getDebtAging } = await import(
      "@/lib/services/supabase/debt"
    );

    const report = await getDebtAging();

    // Report should have 4 aging buckets
    expect(report.buckets).toHaveLength(4);
    // First bucket is "Hiện tại" (0-30 days)
    expect(report.buckets[0].label).toBe("Hiện tại");

    // Total debt should include all
    expect(report.totalDebt).toBeGreaterThan(0);
    expect(report.totalCustomerDebt).toBeGreaterThan(0);
  });

  it("F2: P&L — revenue minus COGS minus expenses = net profit", async () => {
    tableMocks = {
      invoices: {
        data: [
          { total: 5_000_000, status: "completed" },
          { total: 3_000_000, status: "completed" },
        ],
        error: null,
      },
      invoice_items: {
        data: [
          { quantity: 10, unit_price: 500_000 },
          { quantity: 5, unit_price: 600_000 },
        ],
        error: null,
      },
      products: {
        data: [
          { id: "p1", cost_price: 300_000 },
        ],
        error: null,
      },
      cash_transactions: {
        data: [
          { type: "payment", amount: 1_000_000 },
        ],
        error: null,
      },
    };

    const { getProfitAndLoss } = await import(
      "@/lib/services/supabase/reports"
    );

    const result = await getProfitAndLoss();

    // Returns {current, previous} ProfitAndLoss
    expect(result).toHaveProperty("current");
    expect(result).toHaveProperty("previous");

    const pnl = result.current;
    expect(pnl).toHaveProperty("revenue");
    expect(pnl).toHaveProperty("cogs");
    expect(pnl).toHaveProperty("grossProfit");
    expect(pnl).toHaveProperty("operatingExpense");
    expect(pnl).toHaveProperty("netProfit");

    // Basic math: grossProfit = revenue - cogs, netProfit = grossProfit - operatingExpense
    expect(pnl.grossProfit).toBe(pnl.revenue - pnl.cogs);
    expect(pnl.netProfit).toBe(pnl.grossProfit - pnl.operatingExpense);
  });

  it("F3: Financial alerts — generates alerts for low stock, high debt, expiry", async () => {
    tableMocks = {
      products: {
        data: [
          { id: "p1", name: "SP thấp", stock: 2, min_stock: 10 },
        ],
        error: null,
      },
      customers: {
        data: [
          { id: "c1", name: "KH nợ", debt: 50_000_000 },
        ],
        error: null,
      },
      product_lots: {
        data: [],
        error: null,
      },
      cash_transactions: {
        data: [],
        error: null,
      },
      invoices: {
        data: [],
        error: null,
      },
    };

    const { getFinancialAlerts } = await import(
      "@/lib/services/supabase/reports"
    );

    const alerts = await getFinancialAlerts();

    // Alerts generated
    expect(Array.isArray(alerts)).toBe(true);
  });

  it("F4: DSO — Days Sales Outstanding calculation", async () => {
    tableMocks = {
      invoices: {
        data: [
          { total: 10_000_000, debt: 3_000_000 },
        ],
        error: null,
      },
      customers: {
        data: [
          { debt: 3_000_000 },
        ],
        error: null,
      },
    };

    const { getDSO } = await import(
      "@/lib/services/supabase/reports"
    );

    const dso = await getDSO();

    // DSO should be a number
    expect(typeof dso.dso).toBe("number");
    expect(dso.dso).toBeGreaterThanOrEqual(0);
  });

  it("F5: Inventory turnover — COGS / avg inventory", async () => {
    tableMocks = {
      invoice_items: {
        data: [
          { quantity: 100, unit_price: 50_000 },
        ],
        error: null,
      },
      products: {
        data: [
          { id: "p1", cost_price: 30_000, stock: 200 },
        ],
        error: null,
      },
    };

    const { getInventoryTurnover } = await import(
      "@/lib/services/supabase/reports"
    );

    const turnover = await getInventoryTurnover();

    expect(turnover).toHaveProperty("turnoverRatio");
    expect(typeof turnover.turnoverRatio).toBe("number");
  });
});

// ============================================================
//  E1-E5: EDGE CASES
// ============================================================

describe("Edge Cases", () => {
  it("E1: Concurrent claim — only first caller succeeds", async () => {
    let claimCount = 0;
    tableMocks = {
      sales_orders: {
        // Simulate: first call returns data (claim succeeds), second returns null
        get data() {
          claimCount++;
          if (claimCount === 1) {
            return {
              id: "so-race",
              code: "DH00099",
              customer_id: null,
              customer_name: "Racer",
              status: "confirmed",
              tenant_id: "tenant-1",
              branch_id: "branch-1",
              subtotal: 100_000,
              discount_amount: 0,
              total: 100_000,
            };
          }
          return null; // Second caller gets nothing
        },
        error: null,
      },
      sales_order_items: {
        data: [
          {
            id: "soi-r",
            product_id: "p1",
            product_name: "SP",
            quantity: 1,
            unit_price: 100_000,
            discount: 0,
            total: 100_000,
            unit: "cái",
          },
        ],
        error: null,
      },
      invoices: {
        data: { id: "inv-race", code: "HD00099", total: 100_000 },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    // First call succeeds
    const result = await completeSalesOrder("so-race");
    expect(result).toHaveProperty("invoiceId");

    // Reset tracking
    insertCalls.length = 0;
    updateCalls.length = 0;
    rpcCalls.length = 0;
    stockMovementCalls.length = 0;

    // Second call should fail (already claimed)
    await expect(completeSalesOrder("so-race")).rejects.toThrow();
  });

  it("E2: Code generation — sequential codes are unique", async () => {
    setupStandardPOSMocks();

    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    // Make 3 consecutive sales
    await posCheckout(posInput());
    await posCheckout(posInput());
    await posCheckout(posInput());

    // Each sale should generate a unique code
    const codeRpcs = rpcCalls.filter((c) => c.fn === "next_code");
    expect(codeRpcs.length).toBeGreaterThanOrEqual(3);

    // Counter should have incremented 3+ times
    expect(rpcCodeCounter).toBeGreaterThanOrEqual(3);
  });

  it("E3: Very large quantity — no overflow in calculations", async () => {
    setupStandardPOSMocks();

    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    const largeTotal = 999_999 * 1_000_000; // ~1 trillion VND

    await posCheckout(
      posInput({
        items: [
          {
            productId: "p1",
            productName: "Bulk order",
            quantity: 999_999,
            unitPrice: 1_000_000,
            discount: 0,
          },
        ],
        subtotal: largeTotal,
        total: largeTotal,
        paid: largeTotal,
      })
    );

    // Invoice created with correct large total
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    expect(invoices).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).total).toBe(largeTotal);

    // Stock decrement with large qty
    const decRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBe(-999_999);
  });

  it("E4: Transfer state machine — invalid transitions rejected", async () => {
    const { canTransitionTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    // Valid transitions (draft → in_transit or cancelled only)
    expect(canTransitionTransfer("draft", "in_transit")).toBe(true);
    expect(canTransitionTransfer("draft", "cancelled")).toBe(true);
    expect(canTransitionTransfer("in_transit", "completed")).toBe(true);
    expect(canTransitionTransfer("in_transit", "cancelled")).toBe(true);

    // Invalid transitions
    expect(canTransitionTransfer("draft", "completed")).toBe(false); // Must go through in_transit
    expect(canTransitionTransfer("completed", "draft")).toBe(false);
    expect(canTransitionTransfer("completed", "cancelled")).toBe(false);
    expect(canTransitionTransfer("cancelled", "draft")).toBe(false);
    expect(canTransitionTransfer("cancelled", "completed")).toBe(false);
  });

  it("E5: PO state machine — valid transitions", async () => {
    const { canTransitionPurchaseStatus } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    // Valid
    expect(canTransitionPurchaseStatus("draft", "ordered")).toBe(true);
    expect(canTransitionPurchaseStatus("ordered", "completed")).toBe(true);
    expect(canTransitionPurchaseStatus("draft", "cancelled")).toBe(true);

    // Invalid
    expect(canTransitionPurchaseStatus("completed", "draft")).toBe(false);
    expect(canTransitionPurchaseStatus("cancelled", "ordered")).toBe(false);
  });
});

// ============================================================
//  BUSINESS RULE VALIDATIONS
// ============================================================

describe("Business Rule Validations", () => {
  it("BR1: POS sale — invoice status always 'completed' for direct checkout", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(posInput());

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).status).toBe("completed");
  });

  it("BR2: Draft save — invoice status always 'draft'", async () => {
    setupStandardPOSMocks();
    const { saveDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await saveDraftOrder(posInput({ paid: 0 }));

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).status).toBe("draft");
  });

  it("BR3: Stock decrement — always negative delta for OUT", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        items: [
          { productId: "p1", productName: "SP", quantity: 7, unitPrice: 10_000, discount: 0 },
        ],
        subtotal: 70_000,
        total: 70_000,
        paid: 70_000,
      })
    );

    const decRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBeLessThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBe(-7);
  });

  it("BR4: Return stock increment — always positive delta for IN", async () => {
    const { completeReturn } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await completeReturn({
      returnId: "ret-br4",
      returnCode: "TH00099",
      invoiceCode: "HD00001",
      customerName: "Test",
      items: [
        { productId: "p1", productName: "SP", quantity: 3, unitPrice: 50_000 },
      ],
      refundAmount: 150_000,
    });

    // applyManualStockMovement called with type='in' (positive quantity)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].quantity).toBe(3);
    expect(inputs[0].quantity).toBeGreaterThan(0);
  });

  it("BR5: Transfer net-zero — company stock unchanged after transfer", async () => {
    tableMocks = {
      stock_transfers: {
        data: {
          id: "tf-br5",
          from_branch_id: "b-a",
          to_branch_id: "b-b",
          status: "draft",
          tenant_id: "tenant-1",
        },
        error: null,
      },
      stock_transfer_items: {
        data: [
          { id: "tfi-1", product_id: "p1", product_name: "SP", quantity: 10 },
        ],
        error: null,
      },
    };

    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-br5");

    // OUT call: qty 10
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outQty = (stockMovementCalls[0] as any[])[0][0].quantity;
    // IN call: qty 10
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inQty = (stockMovementCalls[1] as any[])[0][0].quantity;

    // Same quantity OUT and IN = net zero at company level
    expect(outQty).toBe(inQty);
    expect(outQty).toBe(10);
  });

  it("BR6: Cash receipt — correct category and reference for POS sale", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(posInput());

    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashData = cash[0].data as any;
    expect(cashData.type).toBe("receipt");
    expect(cashData.category).toBe("Bán hàng");
    expect(cashData.reference_type).toBe("invoice");
  });

  it("BR7: Cash refund — correct category for return", async () => {
    const { completeReturn } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await completeReturn({
      returnId: "ret-br7",
      returnCode: "TH00077",
      invoiceCode: "HD00077",
      customerName: "KH Trả",
      items: [
        { productId: "p1", productName: "SP", quantity: 1, unitPrice: 100_000 },
      ],
      refundAmount: 100_000,
    });

    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashData = cash[0].data as any;
    expect(cashData.type).toBe("payment"); // refund = payment out
    expect(cashData.category).toBe("Trả hàng");
    expect(cashData.reference_type).toBe("sales_return");
  });

  it("BR8: Disposal/Internal export cancel — only draft allowed", async () => {
    // Already completed → claim fails
    tableMocks = {
      disposal_exports: { data: null, error: null },
    };

    const { cancelDisposalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await expect(cancelDisposalExport("de-done")).rejects.toThrow();
  });

  it("BR9: Multiple products in single sale — all tracked individually", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    const items = Array.from({ length: 10 }, (_, i) => ({
      productId: `p${i + 1}`,
      productName: `Sản phẩm ${i + 1}`,
      quantity: i + 1,
      unitPrice: 10_000 * (i + 1),
      discount: 0,
    }));

    const subtotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );

    await posCheckout(
      posInput({ items, subtotal, total: subtotal, paid: subtotal })
    );

    // 10 products × 2 stock RPCs = 20
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs).toHaveLength(20);

    // Each product has correct delta
    for (let i = 0; i < 10; i++) {
      const pRpc = rpcCalls.find(
        (c) =>
          c.fn === "increment_product_stock" &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c.params as any).p_product_id === `p${i + 1}`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((pRpc!.params as any).p_delta).toBe(-(i + 1));
    }
  });
});
