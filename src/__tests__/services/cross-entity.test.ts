import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cross-Entity Automation Tests — Sprint 6 "Cầu Nối"
 *
 * Tests:
 *   - completeSalesOrder: SO → Invoice + Stock + Cash
 *   - completeDisposalExport: Disposal → Stock out
 *   - completeInternalExport: Internal → Stock out
 *   - cancelSalesOrder: atomic cancel guard
 *   - receivePurchaseOrder: PO received → auto input_invoice
 */

// === Track side-effect calls ===
const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: { table: string; data: unknown; filters: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];
let rpcCodeCounter = 0;

// Per-table mock data (override per test)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableMocks: Record<string, any> = {};

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
      const chain = createChain(
        mock ?? { data: null, error: null }
      );
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
      // Migration 00074: atomic disposal + internal export RPC trả { success: true }
      if (fn === "apply_disposal_export_atomic" || fn === "apply_internal_export_atomic") {
        return { data: { success: true, items_processed: 2 }, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({ tenantId: "t1", branchId: "b1", userId: "u1" })
  ),
  getCurrentTenantId: () => Promise.resolve("t1"),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 49 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock stock-adjustments to track calls
const stockMovementCalls: unknown[] = [];
vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: vi.fn((...args: unknown[]) => {
    stockMovementCalls.push(args);
    return Promise.resolve();
  }),
}));

import { completeSalesOrder, cancelSalesOrder } from "@/lib/services/supabase/orders";
import { completeDisposalExport, cancelDisposalExport, completeInternalExport, cancelInternalExport } from "@/lib/services/supabase/inventory";

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  stockMovementCalls.length = 0;
  rpcCodeCounter = 0;
  tableMocks = {};
});

// ========================================
// completeSalesOrder
// ========================================

describe("completeSalesOrder", () => {
  const mockOrder = {
    id: "so1",
    code: "DH001",
    customer_id: "c1",
    customer_name: "Khách ABC",
    total: 1_500_000,
    tenant_id: "t1",
    branch_id: "b1",
    created_by: "u1",
    status: "confirmed",
  };

  const mockSOItems = [
    { id: "soi1", product_id: "p1", product_name: "SP A", unit: "cái", quantity: 5, unit_price: 200_000, discount: 0, total: 1_000_000 },
    { id: "soi2", product_id: "p2", product_name: "SP B", unit: "hộp", quantity: 2, unit_price: 250_000, discount: 0, total: 500_000 },
  ];

  beforeEach(() => {
    tableMocks = {
      sales_orders: { data: mockOrder, error: null },
      sales_order_items: { data: mockSOItems, error: null },
      invoices: { data: { id: "inv1", code: "HD00001" }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("creates an invoice from the sales order", async () => {
    const result = await completeSalesOrder("so1");

    expect(result.invoiceId).toBeDefined();
    expect(result.invoiceCode).toBeDefined();

    // Should have inserted into invoices
    const invoiceInserts = insertCalls.filter((c) => c.table === "invoices");
    expect(invoiceInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invData = invoiceInserts[0].data as any;
    expect(invData.status).toBe("completed");
    expect(invData.customer_name).toBe("Khách ABC");
    expect(invData.total).toBe(1_500_000);
  });

  it("creates invoice_items from SO items", async () => {
    await completeSalesOrder("so1");

    const itemInserts = insertCalls.filter((c) => c.table === "invoice_items");
    expect(itemInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = itemInserts[0].data as any[];
    expect(items).toHaveLength(2);
    expect(items[0].product_name).toBe("SP A");
    expect(items[1].product_name).toBe("SP B");
  });

  it("decrements stock via applyStockDecrement (stock_movements + RPCs)", async () => {
    await completeSalesOrder("so1");

    // Stock movements inserted
    const smInserts = insertCalls.filter((c) => c.table === "stock_movements");
    expect(smInserts.length).toBe(1);

    // RPCs for stock decrement (2 items × 2 RPCs each = 4)
    // + 2 next_code calls (invoice + cash)
    const stockRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs.length).toBe(4); // 2 products × (product_stock + branch_stock)
  });

  it("creates cash receipt for the full amount", async () => {
    await completeSalesOrder("so1");

    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashData = cashInserts[0].data as any;
    expect(cashData.amount).toBe(1_500_000);
    expect(cashData.type).toBe("receipt");
    expect(cashData.category).toBe("Bán hàng");
  });

  it("throws when order is already completed", async () => {
    tableMocks.sales_orders = { data: null, error: null }; // claim fails
    // Mock the fallback status query
    const origFrom = vi.fn();
    // This will fail because the chain returns null, triggering error
    await expect(completeSalesOrder("so1")).rejects.toThrow();
  });
});

// ========================================
// cancelSalesOrder
// ========================================

describe("cancelSalesOrder", () => {
  it("cancels order in new/confirmed status", async () => {
    tableMocks.sales_orders = { data: { id: "so1" }, error: null };

    await expect(cancelSalesOrder("so1")).resolves.not.toThrow();
  });

  it("throws when trying to cancel completed order", async () => {
    tableMocks.sales_orders = { data: null, error: null };

    await expect(cancelSalesOrder("so1")).rejects.toThrow();
  });
});

// ========================================
// completeDisposalExport
// ========================================

describe("completeDisposalExport", () => {
  // Day 1 16/05/2026: refactor sang RPC apply_disposal_export_atomic
  // (migration 00074) — test assert RPC được gọi đúng thay vì applyManualStockMovement.
  it("calls apply_disposal_export_atomic RPC with disposal id", async () => {
    await completeDisposalExport("d1");

    const atomicCall = rpcCalls.find((c) => c.fn === "apply_disposal_export_atomic");
    expect(atomicCall).toBeDefined();
    expect((atomicCall?.params as { p_disposal_id?: string })?.p_disposal_id).toBe("d1");
  });

  it("throws when RPC returns success=false", async () => {
    // Override mock to return non-success → service throws
    const baseMock = await import("@/lib/services/supabase/base");
    const originalGetClient = (baseMock.getClient as unknown) as () => unknown;
    (baseMock as unknown as { getClient: () => unknown }).getClient = () => ({
      from: vi.fn(() => createChain({ data: null, error: null })),
      rpc: vi.fn(() => ({ data: { success: false }, error: null })),
    });
    await expect(completeDisposalExport("d1")).rejects.toThrow();
    // Restore
    (baseMock as unknown as { getClient: () => unknown }).getClient = originalGetClient;
  });
});

// ========================================
// completeInternalExport
// ========================================

describe("completeInternalExport", () => {
  // Day 1 16/05/2026: refactor sang RPC apply_internal_export_atomic
  it("calls apply_internal_export_atomic RPC with export id", async () => {
    await completeInternalExport("ie1");

    const atomicCall = rpcCalls.find((c) => c.fn === "apply_internal_export_atomic");
    expect(atomicCall).toBeDefined();
    expect((atomicCall?.params as { p_export_id?: string })?.p_export_id).toBe("ie1");
  });

  it("throws when RPC returns success=false", async () => {
    const baseMock = await import("@/lib/services/supabase/base");
    const originalGetClient = (baseMock.getClient as unknown) as () => unknown;
    (baseMock as unknown as { getClient: () => unknown }).getClient = () => ({
      from: vi.fn(() => createChain({ data: null, error: null })),
      rpc: vi.fn(() => ({ data: { success: false }, error: null })),
    });
    await expect(completeInternalExport("ie1")).rejects.toThrow();
    (baseMock as unknown as { getClient: () => unknown }).getClient = originalGetClient;
  });
});

// ========================================
// Cancel disposal / internal
// ========================================

describe("cancelDisposalExport", () => {
  it("cancels draft disposal", async () => {
    tableMocks.disposal_exports = { data: { id: "d1" }, error: null };
    await expect(cancelDisposalExport("d1")).resolves.not.toThrow();
  });

  it("throws when disposal is not in draft", async () => {
    tableMocks.disposal_exports = { data: null, error: null };
    await expect(cancelDisposalExport("d1")).rejects.toThrow();
  });
});

describe("cancelInternalExport", () => {
  it("cancels draft internal export", async () => {
    tableMocks.internal_exports = { data: { id: "ie1" }, error: null };
    await expect(cancelInternalExport("ie1")).resolves.not.toThrow();
  });

  it("throws when internal export is not in draft", async () => {
    tableMocks.internal_exports = { data: null, error: null };
    await expect(cancelInternalExport("ie1")).rejects.toThrow();
  });
});
