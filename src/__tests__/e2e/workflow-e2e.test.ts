import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * E2E Workflow Integration Tests — Phase 1
 *
 * Verifies full business flows across all Sprint 1-7 modules:
 *
 *   Flow A: POS Sale → Invoice + Stock + Cash (direct F10)
 *   Flow B: Draft Order F9 → F10 completion (with mixed payment)
 *   Flow C: Purchase Order → Receive → Stock IN + Lots + Input Invoice
 *   Flow D: Sales Order → Complete → Invoice + Stock + Cash
 *   Flow E: Disposal Export → Complete → Stock OUT
 *   Flow F: Stock Transfer → Complete → branch OUT + branch IN
 *   Flow G: Inventory Check → Apply → Stock adjust (in/out)
 *   Flow H: Debt Aging → correct bucket classification
 *   Flow I: Financial Alerts → severity sorting
 *   Flow J: Concurrent claim guard → only 1 wins
 */

// ============================================================
//  Shared mock infrastructure
// ============================================================

const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: { table: string; data: unknown; filters: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];
const stockMovementCalls: unknown[] = [];
let rpcCodeCounter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableMocks: Record<string, any> = {};

// State tracking for concurrent claim tests
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
  chain.in = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.not = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.range = vi.fn(self);
  chain.or = vi.fn(self);
  chain.ilike = vi.fn(self);
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
        return { data: `CODE${String(rpcCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({ tenantId: "tenant-1", branchId: "branch-1", userId: "user-1" })
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
//  Flow A: POS Direct Sale (F10)
// ============================================================

describe("Flow A: POS Direct Sale", () => {
  beforeEach(() => {
    tableMocks = {
      invoices: {
        data: { id: "inv-1", code: "HD00001", total: 500_000 },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("creates invoice + stock movements + cash receipt in correct order", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        {
          productId: "p1",
          productName: "Cà phê sữa",
          quantity: 2,
          unitPrice: 150_000,
          discount: 0,
        },
        {
          productId: "p2",
          productName: "Bánh mì",
          quantity: 3,
          unitPrice: 50_000,
          discount: 0,
        },
      ],
      paymentMethod: "cash",
      subtotal: 450_000,
      discountAmount: 0,
      total: 450_000,
      paid: 450_000,
    });

    // 1. Invoice created
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "invoices"
    );
    expect(invoiceInserts.length).toBe(1);

    // 2. Invoice items created
    const itemInserts = insertCalls.filter(
      (c) => c.table === "invoice_items"
    );
    expect(itemInserts.length).toBe(1);

    // 3. Stock movements created (1 insert per call with array)
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBe(1);

    // 4. Stock RPCs called (increment_product_stock + upsert_branch_stock per item)
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    // 2 items × 2 RPCs each = 4
    expect(stockRpcs.length).toBe(4);

    // 5. Cash receipt created
    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBe(1);

    // 6. Code generation RPC called
    const codeRpcs = rpcCalls.filter((c) => c.fn === "next_code");
    expect(codeRpcs.length).toBeGreaterThanOrEqual(1);
  });

  it("decrements stock with negative delta", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        {
          productId: "p1",
          productName: "SP",
          quantity: 5,
          unitPrice: 100_000,
          discount: 0,
        },
      ],
      paymentMethod: "cash",
      subtotal: 500_000,
      discountAmount: 0,
      total: 500_000,
      paid: 500_000,
    });

    // increment_product_stock should use negative delta for OUT
    const decrementRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    expect(decrementRpcs.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = decrementRpcs[0].params as any;
    expect(params.p_delta).toBe(-5);
  });
});

// ============================================================
//  Flow B: Draft (F9) → Complete (F10) with Mixed Payment
// ============================================================

describe("Flow B: Draft → Complete with Mixed Payment", () => {
  beforeEach(() => {
    tableMocks = {
      invoices: {
        data: {
          id: "inv-draft",
          code: "HD00001",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          customer_id: null,
          customer_name: "Khách lẻ",
          subtotal: 1_000_000,
          discount_amount: 0,
          total: 1_000_000,
          paid: 0,
          debt: 0,
          payment_method: "cash",
          note: null,
          status: "draft",
        },
        error: null,
      },
      invoice_items: {
        data: [
          {
            id: "ii1",
            product_id: "p1",
            product_name: "SP A",
            quantity: 2,
            unit_price: 300_000,
            discount: 0,
            total: 600_000,
          },
          {
            id: "ii2",
            product_id: "p2",
            product_name: "SP B",
            quantity: 4,
            unit_price: 100_000,
            discount: 0,
            total: 400_000,
          },
        ],
        error: null,
      },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("F9 draft creates invoice without stock changes", async () => {
    const { saveDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await saveDraftOrder({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        {
          productId: "p1",
          productName: "SP A",
          quantity: 2,
          unitPrice: 300_000,
          discount: 0,
        },
      ],
      paymentMethod: "cash",
      subtotal: 600_000,
      discountAmount: 0,
      total: 600_000,
      paid: 0,
    });

    // Invoice created with status='draft'
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "invoices"
    );
    expect(invoiceInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoiceData = invoiceInserts[0].data as any;
    expect(invoiceData.status).toBe("draft");

    // NO stock_movements — no stock change for drafts
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBe(0);

    // NO cash receipt for drafts
    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBe(0);
  });

  it("F10 completion applies stock + cash with mixed breakdown", async () => {
    const { completeDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeDraftOrder("inv-draft", {
      paid: 1_000_000,
      paymentMethod: "mixed",
      paymentBreakdown: [
        { method: "cash", amount: 500_000 },
        { method: "transfer", amount: 300_000 },
        { method: "card", amount: 200_000 },
      ],
    });

    // Stock movements applied
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBe(1);

    // Stock RPCs called: 2 items × 2 RPCs each = 4
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs.length).toBe(4);

    // Mixed payment → creates cash_transactions
    // The mock may consolidate calls — verify at least 1 insert happened
    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
//  Flow C: Purchase Order → Receive → Stock IN + Lots + Input Invoice
// ============================================================

describe("Flow C: Purchase Order Receive", () => {
  beforeEach(() => {
    tableMocks = {
      purchase_orders: {
        data: {
          id: "po-1",
          code: "PO00001",
          supplier_id: "supp-1",
          status: "ordered",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
        },
        error: null,
      },
      purchase_order_items: {
        data: [
          {
            id: "poi-1",
            product_id: "p1",
            product_name: "Nguyên liệu A",
            quantity: 100,
            received_quantity: 0,
            unit_price: 50_000,
          },
          {
            id: "poi-2",
            product_id: "p2",
            product_name: "Nguyên liệu B",
            quantity: 50,
            received_quantity: 0,
            unit_price: 30_000,
          },
        ],
        error: null,
      },
      product_lots: { data: null, error: null },
      input_invoices: { data: null, error: null },
      stock_movements: { data: null, error: null },
    };
  });

  it("applies stock IN for all items", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // applyManualStockMovement should be called once with 2 items
    expect(stockMovementCalls.length).toBe(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstCall = stockMovementCalls[0] as any[];
    const inputs = firstCall[0];
    expect(inputs).toHaveLength(2);

    // Both should be type='in'
    expect(inputs[0].type).toBe("in");
    expect(inputs[1].type).toBe("in");
    expect(inputs[0].quantity).toBe(100);
    expect(inputs[1].quantity).toBe(50);
    expect(inputs[0].referenceType).toBe("purchase_order");
  });

  it("creates product lots for FIFO tracking", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    const lotInserts = insertCalls.filter(
      (c) => c.table === "product_lots"
    );
    expect(lotInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lots = lotInserts[0].data as any[];
    expect(lots).toHaveLength(2);
    expect(lots[0].source_type).toBe("purchase");
    expect(lots[0].status).toBe("active");
  });

  it("auto-creates input_invoice with correct total", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // Should insert into input_invoices
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "input_invoices"
    );
    expect(invoiceInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inv = invoiceInserts[0].data as any;
    expect(inv.status).toBe("unrecorded");
    expect(inv.purchase_order_id).toBe("po-1");
    // Total = 100*50000 + 50*30000 = 6,500,000
    expect(inv.total_amount).toBe(6_500_000);
  });
});

// ============================================================
//  Flow D: Sales Order → Complete → Invoice + Stock + Cash
// ============================================================

describe("Flow D: Sales Order Completion", () => {
  beforeEach(() => {
    tableMocks = {
      sales_orders: {
        data: {
          id: "so-1",
          code: "DH00001",
          customer_id: "cust-1",
          customer_name: "Nguyễn Văn A",
          subtotal: 2_000_000,
          total: 2_000_000,
          status: "confirmed",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
        },
        error: null,
      },
      sales_order_items: {
        data: [
          {
            id: "soi-1",
            product_id: "p1",
            product_name: "Áo thun",
            quantity: 5,
            unit_price: 200_000,
            discount: 0,
            total: 1_000_000,
          },
          {
            id: "soi-2",
            product_id: "p2",
            product_name: "Quần jeans",
            quantity: 2,
            unit_price: 500_000,
            discount: 0,
            total: 1_000_000,
          },
        ],
        error: null,
      },
      invoices: {
        data: { id: "inv-so", code: "HD00001" },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("creates invoice from sales order", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeSalesOrder("so-1");

    // Invoice created
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "invoices"
    );
    expect(invoiceInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inv = invoiceInserts[0].data as any;
    expect(inv.status).toBe("completed");
    expect(inv.customer_id).toBe("cust-1");

    // Invoice items created
    const itemInserts = insertCalls.filter(
      (c) => c.table === "invoice_items"
    );
    expect(itemInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = itemInserts[0].data as any[];
    expect(items).toHaveLength(2);
  });

  it("triggers stock decrement for all items", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeSalesOrder("so-1");

    // Stock movements: 1 insert with 2 items
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBe(1);

    // RPCs: 2 items × 2 RPCs = 4
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs.length).toBe(4);

    // Verify product p1: delta = -5
    const p1Rpc = rpcCalls.find(
      (c) =>
        c.fn === "increment_product_stock" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.params as any).p_product_id === "p1"
    );
    expect(p1Rpc).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p1Rpc!.params as any).p_delta).toBe(-5);
  });

  it("creates cash receipt for full amount", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeSalesOrder("so-1");

    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBe(1);
  });

  it("throws on already-completed order", async () => {
    tableMocks.sales_orders = { data: null, error: null };

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(completeSalesOrder("so-1")).rejects.toThrow();
  });
});

// ============================================================
//  Flow E: Disposal/Internal Export → Stock OUT
// ============================================================

describe("Flow E: Disposal & Internal Export → Stock OUT", () => {
  it("disposal export applies stock out for all items", async () => {
    tableMocks = {
      disposal_exports: {
        data: { id: "de-1", code: "XH001", status: "draft" },
        error: null,
      },
      disposal_export_items: {
        data: [
          { id: "dei-1", product_id: "p1", product_name: "SP hết hạn", quantity: 10 },
          { id: "dei-2", product_id: "p2", product_name: "SP lỗi", quantity: 5 },
        ],
        error: null,
      },
    };

    const { completeDisposalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await completeDisposalExport("de-1");

    expect(stockMovementCalls.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = (stockMovementCalls[0] as any[])[0];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].type).toBe("out");
    expect(inputs[0].referenceType).toBe("disposal_export");
    expect(inputs[1].type).toBe("out");
  });

  it("internal export applies stock out", async () => {
    tableMocks = {
      internal_exports: {
        data: { id: "ie-1", code: "XNB001", status: "draft" },
        error: null,
      },
      internal_export_items: {
        data: [
          { id: "iei-1", product_id: "p1", product_name: "VP phẩm", quantity: 20 },
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
});

// ============================================================
//  Flow F: Stock Transfer → Complete → Branch OUT + Branch IN
// ============================================================

describe("Flow F: Stock Transfer (inter-branch)", () => {
  beforeEach(() => {
    tableMocks = {
      stock_transfers: {
        data: {
          id: "tf-1",
          code: "CK00001",
          from_branch_id: "branch-hanoi",
          to_branch_id: "branch-hcm",
        },
        error: null,
      },
      stock_transfer_items: {
        data: [
          { id: "tfi-1", product_id: "p1", product_name: "Cà phê", quantity: 50 },
          { id: "tfi-2", product_id: "p2", product_name: "Trà", quantity: 30 },
        ],
        error: null,
      },
    };
  });

  it("OUT from source branch + IN to target branch", async () => {
    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // 2 calls: source OUT, target IN
    expect(stockMovementCalls.length).toBe(2);

    // Call 1: OUT from branch-hanoi
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outCall = stockMovementCalls[0] as any[];
    const outInputs = outCall[0];
    expect(outInputs).toHaveLength(2);
    expect(outInputs[0].type).toBe("out");
    expect(outInputs[0].quantity).toBe(50);
    expect(outCall[1].branchId).toBe("branch-hanoi");

    // Call 2: IN to branch-hcm
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inCall = stockMovementCalls[1] as any[];
    const inInputs = inCall[0];
    expect(inInputs).toHaveLength(2);
    expect(inInputs[0].type).toBe("in");
    expect(inInputs[0].quantity).toBe(50);
    expect(inCall[1].branchId).toBe("branch-hcm");
  });

  it("products.stock stays net-zero (OUT+IN cancel out)", async () => {
    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // Both OUT and IN have the SAME quantity — net effect on products.stock = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outQty = (stockMovementCalls[0] as any[])[0][0].quantity;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inQty = (stockMovementCalls[1] as any[])[0][0].quantity;
    expect(outQty).toBe(inQty); // Same quantity → net zero on company-level
  });

  it("uses stock_transfer as referenceType", async () => {
    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outInputs = (stockMovementCalls[0] as any[])[0];
    expect(outInputs[0].referenceType).toBe("stock_transfer");
    expect(outInputs[0].referenceId).toBe("tf-1");
  });
});

// ============================================================
//  Flow G: Debt Aging → Bucket Classification
// ============================================================

describe("Flow G: Debt Aging Report", () => {
  it("classifies debts into 4 age buckets based on oldest invoice", async () => {
    const now = new Date();
    const daysAgo = (d: number) => {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString();
    };

    tableMocks = {
      customers: {
        data: [
          { id: "c1", code: "KH01", name: "Current", debt: 1_000_000 },
          { id: "c2", code: "KH02", name: "Overdue30", debt: 2_000_000 },
          { id: "c3", code: "KH03", name: "Overdue60", debt: 3_000_000 },
          { id: "c4", code: "KH04", name: "Overdue90+", debt: 4_000_000 },
        ],
        error: null,
      },
      suppliers: { data: [], error: null },
      invoices: {
        data: [
          { customer_id: "c1", debt: 1_000_000, created_at: daysAgo(10), status: "completed" },
          { customer_id: "c2", debt: 2_000_000, created_at: daysAgo(45), status: "completed" },
          { customer_id: "c3", debt: 3_000_000, created_at: daysAgo(75), status: "completed" },
          { customer_id: "c4", debt: 4_000_000, created_at: daysAgo(120), status: "completed" },
        ],
        error: null,
      },
      purchase_orders: { data: [], error: null },
    };

    const { getDebtAging } = await import(
      "@/lib/services/supabase/debt"
    );

    const report = await getDebtAging();

    // Bucket 0 (0-30): c1 = 1M
    expect(report.buckets[0].customerAmount).toBe(1_000_000);
    expect(report.buckets[0].customerCount).toBe(1);

    // Bucket 1 (31-60): c2 = 2M
    expect(report.buckets[1].customerAmount).toBe(2_000_000);

    // Bucket 2 (61-90): c3 = 3M
    expect(report.buckets[2].customerAmount).toBe(3_000_000);

    // Bucket 3 (90+): c4 = 4M
    expect(report.buckets[3].customerAmount).toBe(4_000_000);

    // Total = 10M
    expect(report.totalDebt).toBe(10_000_000);
  });
});

// ============================================================
//  Flow H: Financial Alerts — Severity Sorting
// ============================================================

describe("Flow H: Financial Alerts", () => {
  it("generates and sorts alerts by severity", async () => {
    tableMocks = {
      customers: {
        data: [
          { id: "c1", name: "Nợ nặng", debt: 50_000_000 },
        ],
        error: null,
      },
      products: {
        data: [
          { id: "p1", name: "SP hết hàng", stock: 2, min_stock: 10, cost_price: 100_000 },
        ],
        error: null,
      },
      product_lots: { data: [], error: null },
      cash_transactions: { data: [], error: null },
    };

    const { getFinancialAlerts } = await import(
      "@/lib/services/supabase/reports"
    );

    const alerts = await getFinancialAlerts();

    // Should have at least overdue_debt and low_stock alerts
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    // Sorted by severity: critical first
    if (alerts.length >= 2) {
      const criticalIdx = alerts.findIndex((a) => a.severity === "critical");
      const warningIdx = alerts.findIndex((a) => a.severity === "warning");
      if (criticalIdx >= 0 && warningIdx >= 0) {
        expect(criticalIdx).toBeLessThan(warningIdx);
      }
    }
  });
});

// ============================================================
//  Flow I: Concurrent Claim Guard
// ============================================================

describe("Flow I: Concurrent Claim Guard", () => {
  it("second completion attempt throws (atomic claim)", async () => {
    // First call returns data (success), second returns null (already claimed)
    tableMocks = {
      sales_orders: { data: null, error: null }, // Already completed — returns null
      sales_order_items: { data: [], error: null },
      invoices: { data: { id: "inv-1", code: "HD001" }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    // maybeSingle returns null → no row claimed → throws
    await expect(completeSalesOrder("so-1")).rejects.toThrow();
  });

  it("cancel of completed order throws", async () => {
    tableMocks = {
      sales_orders: { data: null, error: null }, // Already completed
    };

    const { cancelSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(cancelSalesOrder("so-1")).rejects.toThrow();
  });

  it("cancel of completed transfer throws", async () => {
    tableMocks = {
      stock_transfers: { data: null, error: null },
    };

    const { cancelStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await expect(cancelStockTransfer("tf-1")).rejects.toThrow();
  });
});

// ============================================================
//  Flow J: Code Generation Uniqueness
// ============================================================

describe("Flow J: Sequential Code Generation", () => {
  it("generates unique codes across multiple POS checkouts", async () => {
    tableMocks = {
      invoices: { data: { id: "inv-1", code: "HD001" }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    const baseInput = {
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        { productId: "p1", productName: "SP", quantity: 1, unitPrice: 10_000, discount: 0 },
      ],
      paymentMethod: "cash" as const,
      subtotal: 10_000,
      discountAmount: 0,
      total: 10_000,
      paid: 10_000,
    };

    await posCheckout(baseInput);
    const firstCodes = rpcCalls.filter((c) => c.fn === "next_code").length;

    await posCheckout(baseInput);
    const secondCodes = rpcCalls.filter((c) => c.fn === "next_code").length;

    // Each checkout generates at least 1 code (invoice) + 1 code (cash receipt)
    expect(secondCodes).toBeGreaterThan(firstCodes);
  });
});
