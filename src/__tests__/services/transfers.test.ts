import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Stock Transfers Tests — Sprint 7 "Toàn Cảnh"
 *
 * Tests:
 *   - createStockTransfer: generates code, inserts header + items
 *   - completeStockTransfer: atomic claim + stock OUT source + stock IN target
 *   - cancelStockTransfer: atomic cancel guard
 *   - validation: same branch, empty items
 */

// === Track side-effect calls ===
const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: { table: string; data: unknown; filters: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];
let rpcCodeCounter = 0;

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
        return { data: `CK${String(rpcCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({ tenantId: "t1", branchId: "b1", userId: "u1" })
  ),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 49 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock stock-adjustments
const stockMovementCalls: unknown[] = [];
vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: vi.fn((...args: unknown[]) => {
    stockMovementCalls.push(args);
    return Promise.resolve();
  }),
}));

import {
  createStockTransfer,
  completeStockTransfer,
  cancelStockTransfer,
  canTransitionTransfer,
} from "@/lib/services/supabase/transfers";

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  stockMovementCalls.length = 0;
  rpcCodeCounter = 0;
  tableMocks = {};
});

// ========================================
// State Machine
// ========================================

describe("canTransitionTransfer", () => {
  it("allows draft → in_transit", () => {
    expect(canTransitionTransfer("draft", "in_transit")).toBe(true);
  });

  it("allows draft → cancelled", () => {
    expect(canTransitionTransfer("draft", "cancelled")).toBe(true);
  });

  it("allows in_transit → completed", () => {
    expect(canTransitionTransfer("in_transit", "completed")).toBe(true);
  });

  it("blocks completed → anything", () => {
    expect(canTransitionTransfer("completed", "draft")).toBe(false);
    expect(canTransitionTransfer("completed", "cancelled")).toBe(false);
  });

  it("blocks cancelled → anything", () => {
    expect(canTransitionTransfer("cancelled", "draft")).toBe(false);
  });
});

// ========================================
// createStockTransfer
// ========================================

describe("createStockTransfer", () => {
  beforeEach(() => {
    tableMocks = {
      stock_transfers: { data: { id: "t1", code: "CK00001" }, error: null },
      stock_transfer_items: { data: null, error: null },
      // Stock guard lookup — default to plenty of stock so happy-path tests pass
      branch_stock: {
        data: [
          { product_id: "p1", quantity: 100, reserved: 0 },
          { product_id: "p2", quantity: 50, reserved: 0 },
        ],
        error: null,
      },
    };
  });

  it("creates a transfer with code and items", async () => {
    const result = await createStockTransfer({
      fromBranchId: "branch-a",
      toBranchId: "branch-b",
      items: [
        { productId: "p1", productName: "SP A", productCode: "SPA01", quantity: 10 },
        { productId: "p2", productName: "SP B", productCode: "SPB01", quantity: 5 },
      ],
      note: "Test transfer",
    });

    expect(result.id).toBe("t1");
    expect(result.code).toBe("CK00001");

    // Should generate code via next_code RPC
    const codeRpcs = rpcCalls.filter((c) => c.fn === "next_code");
    expect(codeRpcs.length).toBe(1);

    // Should insert header
    const headerInserts = insertCalls.filter((c) => c.table === "stock_transfers");
    expect(headerInserts.length).toBe(1);

    // Should insert items
    const itemInserts = insertCalls.filter((c) => c.table === "stock_transfer_items");
    expect(itemInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = itemInserts[0].data as any[];
    expect(items).toHaveLength(2);
    expect(items[0].product_name).toBe("SP A");
    expect(items[1].product_name).toBe("SP B");
  });

  it("throws when branches are the same", async () => {
    await expect(
      createStockTransfer({
        fromBranchId: "branch-a",
        toBranchId: "branch-a",
        items: [{ productId: "p1", productName: "SP", productCode: "SP01", quantity: 1 }],
      })
    ).rejects.toThrow("trùng");
  });

  it("throws when items are empty", async () => {
    await expect(
      createStockTransfer({
        fromBranchId: "branch-a",
        toBranchId: "branch-b",
        items: [],
      })
    ).rejects.toThrow("ít nhất 1");
  });

  it("throws when any line has quantity ≤ 0", async () => {
    await expect(
      createStockTransfer({
        fromBranchId: "branch-a",
        toBranchId: "branch-b",
        items: [
          { productId: "p1", productName: "SP A", productCode: "SPA01", quantity: 0 },
        ],
      }),
    ).rejects.toThrow(/lớn hơn 0/);
  });

  it("throws when requested qty exceeds available stock — no DB writes", async () => {
    tableMocks.branch_stock = {
      data: [
        // Chi nhánh xuất còn 5 SP A (reserved 2 = available 3)
        { product_id: "p1", quantity: 5, reserved: 2 },
      ],
      error: null,
    };

    await expect(
      createStockTransfer({
        fromBranchId: "branch-a",
        toBranchId: "branch-b",
        items: [
          { productId: "p1", productName: "SP A", productCode: "SPA01", unit: "cái", quantity: 10 },
        ],
      }),
    ).rejects.toThrow(/Không đủ tồn kho.*SP A.*cần 10.*còn 3/s);

    // CRITICAL: phải fail trước khi ghi DB — tránh tạo phiếu lỗi
    expect(insertCalls.filter((c) => c.table === "stock_transfers")).toHaveLength(0);
    expect(insertCalls.filter((c) => c.table === "stock_transfer_items")).toHaveLength(0);
  });

  it("lists every over-stock product in the error message", async () => {
    tableMocks.branch_stock = {
      data: [
        { product_id: "p1", quantity: 3, reserved: 0 },
        { product_id: "p2", quantity: 2, reserved: 0 },
      ],
      error: null,
    };

    await expect(
      createStockTransfer({
        fromBranchId: "branch-a",
        toBranchId: "branch-b",
        items: [
          { productId: "p1", productName: "SP A", productCode: "SPA01", quantity: 10 },
          { productId: "p2", productName: "SP B", productCode: "SPB01", quantity: 10 },
        ],
      }),
    ).rejects.toThrow(/SP A.*SP B/s);
  });
});

// ========================================
// completeStockTransfer
// ========================================

describe("completeStockTransfer", () => {
  const mockTransfer = {
    id: "t1",
    code: "CK00001",
    from_branch_id: "branch-a",
    to_branch_id: "branch-b",
  };

  const mockItems = [
    { id: "ti1", product_id: "p1", product_name: "SP A", quantity: 10 },
    { id: "ti2", product_id: "p2", product_name: "SP B", quantity: 5 },
  ];

  beforeEach(() => {
    tableMocks = {
      stock_transfers: { data: mockTransfer, error: null },
      stock_transfer_items: { data: mockItems, error: null },
    };
  });

  it("calls stock OUT for source branch", async () => {
    await completeStockTransfer("t1");

    // Should have 2 calls: OUT from source, IN to target
    expect(stockMovementCalls.length).toBe(2);

    // First call = OUT from source branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outCall = stockMovementCalls[0] as any[];
    const outInputs = outCall[0];
    expect(outInputs).toHaveLength(2);
    expect(outInputs[0].type).toBe("out");
    expect(outInputs[0].quantity).toBe(10);
    expect(outInputs[0].referenceType).toBe("stock_transfer");

    // Context should have source branch
    const outCtx = outCall[1];
    expect(outCtx.branchId).toBe("branch-a");
  });

  it("calls stock IN for target branch", async () => {
    await completeStockTransfer("t1");

    // Second call = IN to target branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inCall = stockMovementCalls[1] as any[];
    const inInputs = inCall[0];
    expect(inInputs).toHaveLength(2);
    expect(inInputs[0].type).toBe("in");
    expect(inInputs[0].quantity).toBe(10);
    expect(inInputs[1].type).toBe("in");
    expect(inInputs[1].quantity).toBe(5);

    // Context should have target branch
    const inCtx = inCall[1];
    expect(inCtx.branchId).toBe("branch-b");
  });

  it("throws when transfer is already completed", async () => {
    tableMocks.stock_transfers = { data: null, error: null };
    await expect(completeStockTransfer("t1")).rejects.toThrow();
  });
});

// ========================================
// cancelStockTransfer
// ========================================

describe("cancelStockTransfer", () => {
  it("cancels draft/in_transit transfer", async () => {
    tableMocks.stock_transfers = { data: { id: "t1" }, error: null };
    await expect(cancelStockTransfer("t1")).resolves.not.toThrow();
  });

  it("throws when transfer is already completed", async () => {
    tableMocks.stock_transfers = { data: null, error: null };
    await expect(cancelStockTransfer("t1")).rejects.toThrow();
  });
});
